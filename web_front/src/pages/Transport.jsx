import {Fragment,useId} from 'react';
import useDialogStack from '../hooks/useDialogStack';
import ModalCloseButton from '../components/ModalCloseButton';
import useDialogAccessibility, { canDismissDialog } from '../hooks/useDialogAccessibility';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AlertTriangle,
  Bus,
  MapPin,
  Phone,
} from 'lucide-react';

import Topbar from '../components/Topbar';
import StatCard from '../components/StatCard';
import Footer from '../components/Footer';
import { PageHeading, DemoNotice } from '../components/ManagementUI';
import ActionButton from '../components/ActionButton';
import SearchBar from '../components/SearchBar';
import DataTable from '../components/DataTable';

import {
  STORAGE_KEYS,
  initialBuses,
  initialStudents,
  getTodayDate,
} from '../data/mockData';

import '../style/Transport.css';
import BusTransportMonitoring from '../components/BusTransportMonitoring';

function readArray(key, fallback) {
  try {
    const saved = localStorage.getItem(key);

    if (saved === null) return fallback;

    const parsed = JSON.parse(saved);

    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getChildId(child) {
  return String(child.childId || child.id || '');
}

function getDemoBuses() {
  const today = getTodayDate();

  const demoPassengers = {
    'BUS-01': ['STU-001', 'STU-003'],
    'BUS-02': ['STU-002'],
    'BUS-03': ['STU-005'],
  };

  return initialBuses.map((bus) => ({
    ...bus,
    dailyPassengers: bus.dailyPassengers || {
      [today]: demoPassengers[bus.id] || [],
    },
  }));
}

function loadTransportData() {
  return {
    buses: readArray(
      STORAGE_KEYS.buses,
      getDemoBuses()
    ),
    children: readArray(
      STORAGE_KEYS.children,
      initialStudents
    ),
  };
}

function emptyForm() {
  return {
    id: '',
    vehicleNo: '',
    routeName: '',
    driverName: '',
    driverPhone: '',
    currentLocation: '',
    operatingToday: true,
    passengerIds: [],
  };
}

/* Modal remains inside this page. */
function TransportModal({
  title,
  className = '',
  onClose,
  children,
}) {
  const modalRef = useRef(null),titleId=useId();


  useDialogAccessibility(modalRef, onClose);

  return (
    <div
      className="tr-modal-overlay"
      onClick={event=>{if(event.target===event.currentTarget&&canDismissDialog(modalRef.current)){event.stopPropagation();onClose();}}}
    >
      <section
        ref={modalRef}
        className={`tr-modal ${className}`}
        role="dialog" data-dialog-size="medium"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tr-modal-header">
          <h3 id={titleId}>{title}</h3>

          <ModalCloseButton onClick={onClose} />
        </div>

        {children}
      </section>
    </div>
  );
}

export default function Transport() {
  const [data, setData] = useState(loadTransportData);
  const [today, setToday] = useState(getTodayDate);
  const [searchTerm, setSearchTerm] = useState('');

  const {modal,layers:modalLayers,setModal}=useDialogStack();
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState('');

  const { buses, children } = data;

  useEffect(() => {
    const refresh = () => setData(loadTransportData());

    const events = [
      'storage',
      'storageUpdated',
      'storage-updated',
    ];

    events.forEach((name) =>
      window.addEventListener(name, refresh)
    );

    const timer = window.setInterval(() => {
      setToday(getTodayDate());
    }, 60000);

    return () => {
      events.forEach((name) =>
        window.removeEventListener(name, refresh)
      );

      window.clearInterval(timer);
    };
  }, []);

  const busRows = useMemo(
    () =>
      buses.map((bus) => {
        const assignedChildren = children.filter(
          (child) => child.busId === bus.id
        );

        const assignedIds = new Set(
          assignedChildren.map(getChildId)
        );

        const operating =
          bus.operatingDates?.includes(today) || false;

        const savedPassengers =
          bus.dailyPassengers?.[today];

        const passengerIds = Array.isArray(savedPassengers)
          ? [...new Set(savedPassengers.map(String))].filter(
              (id) => assignedIds.has(id)
            )
          : null;

        return {
          ...bus,
          operating,
          assignedCount: assignedChildren.length,
          passengerIds,
          travellingCount: !operating
            ? 0
            : passengerIds === null
              ? null
              : passengerIds.length,
        };
      }),
    [buses, children, today]
  );

  const filteredBuses = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return busRows.filter((bus) =>
      [
        bus.id,
        bus.vehicleNo,
        bus.routeName,
        bus.driverName,
        bus.driverPhone,
        bus.currentLocation,
      ].some((value) =>
        String(value || '').toLowerCase().includes(query)
      )
    );
  }, [busRows, searchTerm]);

  const selectedBus = busRows.find(
    (bus) => bus.id === modal?.busId
  );

  const formAssignedChildren = children.filter(
    (child) => child.busId === formData.id
  );

  const closeModal = () => {
    if(!canDismissDialog())return;
    setModal(null);
    setFormError('');
  };

  const saveBuses = (nextBuses) => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.buses,
        JSON.stringify(nextBuses)
      );
    } catch {
      setFormError(
        'Unable to save changes in this browser. Please try again.'
      );
      return false;
    }

    setData((current) => ({
      ...current,
      buses: nextBuses,
    }));

    window.dispatchEvent(new Event('storageUpdated'));
    window.dispatchEvent(new Event('storage-updated'));

    return true;
  };

  const getNextBusId = () => {
    const largest = buses.reduce((maximum, bus) => {
      const number = Number.parseInt(
        String(bus.id).replace(/\D/g, ''),
        10
      );

      return Number.isNaN(number)
        ? maximum
        : Math.max(maximum, number);
    }, 0);

    return `BUS-${String(largest + 1).padStart(2, '0')}`;
  };

  const openAdd = () => {
    setFormData({
      ...emptyForm(),
      id: getNextBusId(),
    });

    setFormError('');
    setModal({ type: 'add' });
  };

  const openEdit = (bus) => {
    setFormData({
      id: bus.id,
      vehicleNo: bus.vehicleNo || '',
      routeName: bus.routeName || '',
      driverName: bus.driverName || '',
      driverPhone: bus.driverPhone || '',
      currentLocation: bus.currentLocation || '',
      operatingToday: bus.operating,
      passengerIds: bus.passengerIds || [],
    });

    setFormError('');
    setModal({ type: 'edit', busId: bus.id });
  };

  const openDelete = (bus) => {
    setFormError('');
    setModal({ type: 'delete', busId: bus.id });
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));

    setFormError('');
  };

  const togglePassenger = (id) => {
    setFormData((current) => ({
      ...current,
      passengerIds: current.passengerIds.includes(id)
        ? current.passengerIds.filter((item) => item !== id)
        : [...current.passengerIds, id],
    }));
  };

  const handleSaveBus = (event) => {
    event.preventDefault();

    if (getTodayDate() !== today) {
      setToday(getTodayDate());
      setFormError(
        'The date has changed. Review today’s passenger list before saving.'
      );
      return;
    }

    const fields = [
      'vehicleNo',
      'routeName',
      'driverName',
      'driverPhone',
      'currentLocation',
    ];

    const cleaned = Object.fromEntries(
      fields.map((name) => [
        name,
        String(formData[name]).trim(),
      ])
    );

    if (fields.some((name) => !cleaned[name])) {
      setFormError('Complete all required fields.');
      return;
    }

    if (
      buses.some(
        (bus) =>
          bus.id !== formData.id &&
          String(bus.vehicleNo).trim().toLowerCase() ===
            cleaned.vehicleNo.toLowerCase()
      )
    ) {
      setFormError(
        'This vehicle number is already registered.'
      );
      return;
    }

    if (
      modal.type === 'add' &&
      buses.some((bus) => bus.id === formData.id)
    ) {
      setFormError(
        'This bus ID already exists. Close and reopen the add form.'
      );
      return;
    }

    const existing = buses.find(
      (bus) => bus.id === modal.busId
    );

    if (modal.type === 'edit' && !existing) {
      setFormError('This bus is no longer available.');
      return;
    }

    const operatingDates = new Set(
      existing?.operatingDates || []
    );

    if (formData.operatingToday) {
      operatingDates.add(today);
    } else {
      operatingDates.delete(today);
    }

    const allowedIds = new Set(
      formAssignedChildren.map(getChildId)
    );

    const passengerIds = formData.operatingToday
      ? formData.passengerIds.filter(
          (id) => allowedIds.has(id)
        )
      : [];

    const savedBus = {
      ...existing,
      ...cleaned,
      id: formData.id,
      totalStudents: formAssignedChildren.length,
      operatingDates: [...operatingDates],
      dailyPassengers: {
        ...existing?.dailyPassengers,
        [today]: passengerIds,
      },
    };

    const nextBuses =
      modal.type === 'edit'
        ? buses.map((bus) =>
            bus.id === modal.busId ? savedBus : bus
          )
        : [...buses, savedBus];

    if (saveBuses(nextBuses)) {
      setModal(null);setFormError('');
    }
  };

  const confirmDeleteBus = () => {
    if (!selectedBus) return;

    if (selectedBus.assignedCount > 0) {
      setFormError(
        'Reassign this bus’s children before deleting it.'
      );
      return;
    }

    if (
      saveBuses(
        buses.filter((bus) => bus.id !== selectedBus.id)
      )
    ) {
      closeModal();
    }
  };

  const displayDate = new Date(
    `${today}T12:00:00Z`
  ).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  /* DataTable column configuration */
  const columns = [
    {
      key: 'id',
      label: 'Bus ID',
      className: 'cg-table-id',
    },
    {
      key: 'vehicleNo',
      label: 'Vehicle No.',
      className: 'cg-table-nowrap',
    },
    {
      key: 'routeName',
      label: 'Route',
      className: 'tr-route-cell',
    },
    {
      key: 'driverName',
      label: 'Driver',
    },
    {
      key: 'driverPhone',
      label: 'Contact',
      render: (bus) =>
        bus.driverPhone ? (
          <a
            className="tr-phone"
            href={`tel:${String(bus.driverPhone).replace(
              /[^\d+]/g,
              ''
            )}`}
          >
            <Phone size={13} aria-hidden="true" />
            {bus.driverPhone}
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'assignedCount',
      label: 'Assigned Children',
      align: 'center',
      render: (bus) => (
        <strong className="tr-count">
          {bus.assignedCount}
        </strong>
      ),
    },
    {
      key: 'travellingCount',
      label: 'Travelling Today',
      align: 'center',
      render: (bus) => (
        <>
          <strong className="tr-today-count">
            {bus.travellingCount === null
              ? '—'
              : bus.travellingCount}
          </strong>

          {bus.travellingCount === null && (
            <small className="tr-count-note">
              Not recorded
            </small>
          )}
        </>
      ),
    },
    {
      key: 'currentLocation',
      label: 'Last Location',
      className: 'tr-location-cell',
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (bus) => (
        <div className="cg-table-actions">
          <ActionButton
            variant="location"
            size="small"
            aria-label={`View ${bus.id} location`}
            onClick={() =>
              setModal({
                type: 'location',
                busId: bus.id,
              })
            }
          />

          <ActionButton
            variant="edit"
            size="small"
            aria-label={`Edit ${bus.id}`}
            onClick={() => openEdit(bus)}
          />

          <ActionButton
            variant="delete"
            size="small"
            aria-label={`Delete ${bus.id}`}
            onClick={() => openDelete(bus)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="tr-page">
      <Topbar hideTitle />

      <main className="tr-container cg-admin-content"><PageHeading title="Transport Information"></PageHeading><BusTransportMonitoring/><DemoNotice/>
        <section
          className="tr-stats-grid"
          aria-label="Bus statistics"
        >
          <StatCard
            title="Buses"
            value={buses.length}
            icon={Bus}
            color="blue"
            iconPosition="left"
          />
        </section>

        <div className="tr-toolbar">
          <div className="tr-toolbar-actions">
            <ActionButton variant="add" onClick={openAdd}>
              Add New Bus
            </ActionButton>

            <ActionButton
              variant="viewAll"
              onClick={() => setModal({ type: 'all-map' })}
            >
              View All Buses on Map
            </ActionButton>
          </div>

          <div className="tr-search-wrapper">
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search bus, vehicle, route or driver..."
              label="Search buses"
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          data={filteredBuses}
          rowKey="id"
          caption="Transport buses"
          minWidth={1300}
          emptyMessage="No buses match your search."
        />
      </main>

      <Footer />

      {/* Add / edit bus */}
      {modalLayers.map(layer=>{const modal=layer.value;const selectedBus=busRows.find(bus=>bus.id===modal?.busId);return <Fragment key={layer.id}>
      {['add', 'edit'].includes(modal?.type) && (
        <TransportModal
          key={`${modal.type}-${formData.id}`}
          title={
            modal.type === 'edit'
              ? 'Edit Bus Information'
              : 'Add New Bus'
          }
          onClose={closeModal}
        >
          <form onSubmit={handleSaveBus}>
            <div className="tr-form-group">
              <label htmlFor="tr-bus-id">Bus ID</label>

              <input
                id="tr-bus-id"
                value={formData.id}
                disabled
              />
            </div>

            {[
              ['vehicleNo', 'Vehicle Number'],
              ['routeName', 'Route'],
              ['driverName', 'Driver Name'],
              ['driverPhone', 'Driver Phone'],
              ['currentLocation', 'Last Location'],
            ].map(([name, label]) => (
              <div className="tr-form-group" key={name}>
                <label htmlFor={`tr-${name}`}>
                  {label}
                </label>

                <input
                  id={`tr-${name}`}
                  name={name}
                  type={
                    name === 'driverPhone' ? 'tel' : 'text'
                  }
                  value={formData[name]}
                  onChange={handleInputChange}
                  required
                />
              </div>
            ))}

            <label className="tr-check-row">
              <input
                type="checkbox"
                checked={formData.operatingToday}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    operatingToday: event.target.checked,
                  }))
                }
              />

              <span>
                Bus operating today — {displayDate}
              </span>
            </label>

            <fieldset
              className="tr-passenger-fieldset"
              disabled={!formData.operatingToday}
            >
              <legend>Children travelling today</legend>

              <p>
                Select from this bus’s assigned children.
              </p>

              {formAssignedChildren.length > 0 ? (
                formAssignedChildren.map((child) => {
                  const id = getChildId(child);

                  return (
                    <label
                      className="tr-passenger-row"
                      key={id}
                    >
                      <input
                        type="checkbox"
                        checked={formData.passengerIds.includes(id)}
                        onChange={() => togglePassenger(id)}
                      />

                      <span>
                        <strong>{child.name}</strong>
                        <small>{id}</small>
                      </span>
                    </label>
                  );
                })
              ) : (
                <p>
                  No children assigned. Assign children
                  from the Children page first.
                </p>
              )}
            </fieldset>

            {formError && (
              <p className="tr-form-error" role="alert">
                {formError}
              </p>
            )}

            <div className="tr-modal-actions">
              <ActionButton
                variant="secondary"
                onClick={closeModal}
              >
                Cancel
              </ActionButton>

              <ActionButton variant="primary" type="submit">
                Save Changes
              </ActionButton>
            </div>
          </form>
        </TransportModal>
      )}

      {/* Location only */}
      {modal?.type === 'location' && selectedBus && (
        <TransportModal
          key={`location-${selectedBus.id}`}
          title={`Bus Location: ${selectedBus.id}`}
          onClose={closeModal}
        >
          <p className="tr-demo-note">
            Demo location preview — not live GPS tracking.
          </p>

          <div className="tr-map-preview">
            <MapPin size={30} aria-hidden="true" />

            <strong>
              {selectedBus.currentLocation ||
                'Location unavailable'}
            </strong>
          </div>

          <div className="tr-modal-actions">
            <ActionButton
              variant="secondary"
              onClick={closeModal}
            >
              Close
            </ActionButton>
          </div>
        </TransportModal>
      )}

      {/* All buses location preview */}
      {modal?.type === 'all-map' && (
        <TransportModal
          key="all-map"
          title="All Bus Locations"
          className="tr-all-map-modal"
          onClose={closeModal}
        >
          <p className="tr-demo-note">
            Demo preview. Marker positions are illustrative.
          </p>

          <div className="tr-all-map">
            {busRows.map((bus, index) => (
              <button
                type="button"
                key={bus.id}
                className="tr-map-marker"
                style={{
                  left: `${15 + ((index * 23) % 70)}%`,
                  top: `${18 + ((index * 19) % 65)}%`,
                }}
                onClick={() =>
                  setModal({
                    type: 'location',
                    busId: bus.id,
                  })
                }
                aria-label={`View location of ${bus.id}`}
              >
                <Bus size={18} aria-hidden="true" />

                <span>
                  {bus.id}
                  <small>{bus.currentLocation}</small>
                </span>
              </button>
            ))}

            {busRows.length === 0 && (
              <p className="tr-map-empty">
                No buses available.
              </p>
            )}
          </div>

          <div className="tr-modal-actions">
            <ActionButton
              variant="secondary"
              onClick={closeModal}
            >
              Close Map
            </ActionButton>
          </div>
        </TransportModal>
      )}

      {/* Delete confirmation */}
      {modal?.type === 'delete' && selectedBus && (
        <TransportModal
          key={`delete-${selectedBus.id}`}
          title="Delete Bus?"
          className="tr-delete-modal"
          onClose={closeModal}
        >
          <div className="tr-delete-icon">
            <AlertTriangle size={26} aria-hidden="true" />
          </div>

          <p>
            Remove <strong>{selectedBus.id}</strong>
            {' '}({selectedBus.vehicleNo})?
          </p>

          {selectedBus.assignedCount > 0 && (
            <p className="tr-form-error">
              This bus has {selectedBus.assignedCount}
              {' '}assigned children. Reassign them before
              deleting the bus.
            </p>
          )}

          {formError && (
            <p className="tr-form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="tr-modal-actions">
            <ActionButton
              variant="secondary"
              onClick={closeModal}
            >
              Cancel
            </ActionButton>

            <ActionButton
              variant="delete"
              disabled={selectedBus.assignedCount > 0}
              onClick={confirmDeleteBus}
            >
              Delete
            </ActionButton>
          </div>
        </TransportModal>
      )}
      </Fragment>;})}
    </div>
  );
}
