import {Fragment,useId} from 'react';
import useDialogStack from '../hooks/useDialogStack';
import TechnicalDetails from '../components/TechnicalDetails';
import { proximityLabel } from '../lib/ui-language';
import ModalCloseButton from '../components/ModalCloseButton';
import useDialogAccessibility, { canDismissDialog } from '../hooks/useDialogAccessibility';
import { useEffect, useRef, useState } from 'react';

import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Radio,
} from 'lucide-react';

import Topbar from '../components/Topbar';
import StatCard from '../components/StatCard';
import Footer from '../components/Footer';
import SearchBar from '../components/SearchBar';
import DataTable from '../components/DataTable';
import ActionButton from '../components/ActionButton';
import FilterOption from '../components/FilterOption';
import { StatusPill } from '../components/ManagementUI';

import { api } from '../lib/api';
import usePollingApi from '../hooks/usePollingApi';

import '../style/Beacons.css';
import '../style/SafetyRestoration.css';
import '../style/Device.css';

const emptyForm = {
  hardwareId:'',name:'',location:'',description:'',kind:'DANGER_ZONE',
  serviceUuid:'',entryRssi:-63,exitRssi:-69,attendanceRssi:null,active:true,
};
const gateIdentity={hardwareId:'CG-GATE-01',serviceUuid:'7b700001-24a6-4a25-9d3b-21c547a10001'};
const time=value=>value ? new Date(value).toLocaleString() : 'Not observed';

function BeaconModal({
  title,
  className = '',
  busy = false,
  onClose,
  children,
}) {
  const modalRef = useRef(null),titleId=useId();


  useDialogAccessibility(modalRef, onClose, {busy});

  return (
    <div
      className="sz-modal-overlay"
      onClick={event=>{if(event.target===event.currentTarget&&canDismissDialog(modalRef.current)){event.stopPropagation();onClose();}}}
    >
      <section
        ref={modalRef}
        className={`sz-modal-content ${className}`}
        role="dialog" data-dialog-size="medium"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sz-modal-header">
          <h3 id={titleId}>{title}</h3>

          <ModalCloseButton onClick={onClose} disabled={busy} />
        </div>

        {children}
      </section>
    </div>
  );
}

function BeaconStatus({ status }) {
  const tone =
    status === 'Active'
      ? 'sz-badge--active'
      : status === 'Inactive'
        ? 'sz-badge--inactive'
        : '';

  return (
    <span className={`sz-badge ${tone}`}>
      {status || 'Unknown'}
    </span>
  );
}

export default function Beacons() {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    const tick=()=>{if(!document.hidden)setNow(Date.now());};
    const timer=setInterval(tick,1000);document.addEventListener('visibilitychange',tick);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
  },[]);
  const [offset,setOffset]=useState(0);
  const live=usePollingApi(`/api/v1/beacons?limit=25&offset=${offset}`,'childguard:beacons-updated');
  const me=usePollingApi('/api/v1/auth/me');
  const gateRegistration=usePollingApi(me.data?.role==='ADMIN'?'/api/v1/beacons/gate-registration':null,'childguard:beacons-updated');
  const existingGate=gateRegistration.data?.gate;
  const beacons=live.data||[];
  const stale=beacon=>{
    const observation=beacon.observation,age=Math.max(now,live.updatedAt??now)-Date.parse(observation?.observedAt);
    return !beacon.active||observation?.stale||!Number.isFinite(age)||age<0||age>(observation?.staleAfterMs||45000);
  };
  const canManage=me.data?.role==='ADMIN';
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const inFlight=useRef(false);
  const [searchTerm, setSearchTerm] = useState('');

  const {modal,layers:modalLayers,setModal}=useDialogStack();
  const [formData, setFormData] = useState({
    ...emptyForm,
  });
  const [formError, setFormError] = useState('');

  const activeBeacons = beacons.filter(
    (beacon) => beacon.active
  ).length;

  const inactiveBeacons = beacons.filter(
    (beacon) => !beacon.active
  ).length;

  const query = searchTerm.trim().toLowerCase();

  const filteredBeacons = beacons.filter((beacon) =>
    [
      beacon.hardwareId,
      beacon.name,
      beacon.kind,
      beacon.location,
    ].some((value) =>
      String(value || '').toLowerCase().includes(query)
    )
  );

  const selectedBeacon = beacons.find(
    (beacon) => beacon.id === modal?.beaconId
  );

  const closeModal = () => {
    if(inFlight.current) return;
    if(!canDismissDialog())return;
    setModal(null);
    setFormError('');
  };

  const openAdd = () => {
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    setFormData({...emptyForm,serviceUuid:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`});
    setFormError('');setModal({type:'add'});
  };

  const openEdit = (beacon) => {
    setFormData({
      ...emptyForm,
      ...beacon,
    });

    setFormError('');
    setModal({
      type: 'edit',
      beaconId: beacon.id,
    });
  };

  const updateField = (name, value) => {
    if(name==='kind') {
      setFormData(current=>value==='GATE'?{...current,...gateIdentity,kind:value,attendanceRssi:-55,active:true}:{...current,kind:value,hardwareId:'',serviceUuid:'',attendanceRssi:null});
      setFormError('');return;
    }
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));

    setFormError('');
  };

  const handleSave = async event => {
    event.preventDefault();if(inFlight.current || !canManage) return;
    let identityChangeAcknowledged=false;
    if(modal.type==='edit' && selectedBeacon.serviceUuid!==formData.serviceUuid) {
      if(!window.confirm('Changing the UUID requires reflashing the physical beacon. Monitoring will stop matching the old UUID. Continue?')) return;
      identityChangeAcknowledged=true;
    }
    const body={name:formData.name,location:formData.location,description:formData.description,serviceUuid:formData.serviceUuid,entryRssi:Number(formData.entryRssi),exitRssi:Number(formData.exitRssi),attendanceRssi:formData.kind==='GATE'?Number(formData.attendanceRssi):null,active:formData.active};
    if(modal.type==='add') Object.assign(body,{hardwareId:formData.hardwareId,kind:formData.kind});
    else body.identityChangeAcknowledged=identityChangeAcknowledged;
    inFlight.current=true;setSaving(true);setFormError('');
    try {
      const saved=await api(modal.type==='add'?'/api/v1/beacons':`/api/v1/beacons/${encodeURIComponent(modal.beaconId)}`,{method:modal.type==='add'?'POST':'PATCH',body:JSON.stringify(body)});
      setMessage(`Saved ${saved.hardwareId}. Ask the project owner to configure any new or changed Bluetooth code on the physical beacon.`);
      setModal(null);window.dispatchEvent(new Event('childguard:beacons-updated'));
    } catch(error){setFormError(error.message);}
    finally{inFlight.current=false;setSaving(false);}
  };
  const toggleActive=async beacon=>{
    if(inFlight.current || !canManage || beacon.kind==='GATE') return;
    if(!window.confirm(`${beacon.active?'Deactivate':'Activate'} ${beacon.hardwareId}? History is retained. Wearables refresh within 60 seconds.`)) return;
    inFlight.current=true;setSaving(true);setMessage('');
    try {
      const {name,location,description,serviceUuid,entryRssi,exitRssi,attendanceRssi}=beacon;
      await api(`/api/v1/beacons/${encodeURIComponent(beacon.id)}`,{method:'PATCH',body:JSON.stringify({name,location,description,serviceUuid,entryRssi,exitRssi,attendanceRssi,active:!beacon.active})});
      setMessage(`${beacon.hardwareId} ${beacon.active?'deactivated':'activated'}.`);window.dispatchEvent(new Event('childguard:beacons-updated'));
    } catch(error){setMessage(error.message);}
    finally{inFlight.current=false;setSaving(false);}
  };

  const columns = [
    {key:'hardwareId',label:'Beacon ID'}, {key:'name',label:'Beacon Name'},
    {key:'location',label:'Location'}, {key:'kind',label:'Type',render:beacon=><StatusPill tone={beacon.kind==='GATE'?'info':'warning'}>{beacon.kind==='GATE'?'Gate':beacon.kind==='DANGER_ZONE'?'Danger zone':beacon.kind}</StatusPill>},
    {key:'serviceUuid',label:'Bluetooth code (UUID)'},
    {key:'registrationStatus',label:'Registration',render:b=>b.registrationStatus==='REGISTERED'?'Registered':'Setup needed'},
    {key:'active',label:'Configuration',render:b=><BeaconStatus status={b.active?'Active':'Inactive'} />},
    {key:'proximity',label:'Wearable Proximity',render:b=>{const state=stale(b)?'UNKNOWN':b.observation?.proximity||'UNKNOWN';return <span className={`dv-badge dv-badge--${state==='NEAR'?'near':state==='FAR'?'success':'unknown'}`}>{proximityLabel(state)} - {stale(b)?'No recent update':'Recent'}</span>;}},
    {key:'rssi',label:'Bluetooth signal strength',render:b=>b.observation?.rssi==null?'Unavailable':`${b.observation.rssi} dBm${stale(b)?' (historical)':''}`},
    {key:'time',label:'Last Detected',render:b=>time(b.observation?.observedAt)},
    {key:'wearable',label:'Detected By',render:b=>b.observation?.wearableId||'Not observed'},
    {key:'actions',label:'Actions',render:b=><div className="cg-table-actions">
      <ActionButton variant="location" size="small" onClick={()=>setModal({type:'map',beaconId:b.id})}>View details</ActionButton>
      {canManage && <><ActionButton variant="edit" size="small" aria-label={`Edit ${b.name||b.hardwareId}`} disabled={saving} onClick={()=>openEdit(b)} />
      <ActionButton variant="secondary" size="small" disabled={saving||b.kind==='GATE'} onClick={()=>toggleActive(b)}>{b.active?'Deactivate':'Activate'}</ActionButton></>}
    </div>},
  ];

  const renderBeaconField=([name,label]) => (
              <div className="sz-form-group" key={name}>
                <label htmlFor={`sz-${name}`}>
                  {label}
                </label>

                <input
                  id={`sz-${name}`}
                  type={name.endsWith('Rssi')?'number':'text'}
                  step={name.endsWith('Rssi')?'0.1':undefined}
                  min={name.endsWith('Rssi')?-127:undefined}
                  max={name.endsWith('Rssi')?0:undefined}
                  disabled={saving||(modal.type==='edit'&&name==='hardwareId')||(formData.kind==='GATE'&&['hardwareId','serviceUuid'].includes(name))}
                  value={formData[name]??''}
                  onChange={(event) =>
                    updateField(name, event.target.value)
                  }
                  required={name!=='description'}
                />
              </div>
  );

  return (
    <div className="sz-page">
      <Topbar />

      <main className="sz-container cg-admin-content"><p className="cg-important-note">Nearby shows Bluetooth proximity only. It does not always create a danger alert. Check Alerts &amp; Notifications for recorded alerts.</p>
        <section
          className="sz-stats-grid"
          aria-label="Beacon statistics"
        >
          <StatCard
            title="Beacons Shown"
            value={beacons.length}
            icon={Radio}
            color="blue"
            iconPosition="left"
          />

          <StatCard
            title="Active"
            value={activeBeacons}
            icon={CheckCircle2}
            color="green"
            iconPosition="left"
          />

          <StatCard
            title="Inactive"
            value={inactiveBeacons}
            icon={AlertTriangle}
            color="red"
            iconPosition="left"
          />
        </section>

        <div className="sz-toolbar">
          <div className="sz-toolbar-actions">
            <ActionButton variant="add" disabled={!canManage||saving} onClick={openAdd}>
              Register Beacon
            </ActionButton>

            <ActionButton
              variant="viewAll"
              onClick={() => setModal({ type: 'all-map' })}
            >
              View Registered Locations
            </ActionButton>
          </div>

          <div className="sz-search-wrapper">
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search this page by name, location or ID..."
              label="Search Bluetooth beacons"
            />
          </div>
        </div>

        <p>Manage up to 8 active Bluetooth beacons, including one Gate, in your center. Use GPS Safe Area for the separate GPS boundary.</p>
        {message && <p role="status">{message}</p>}
        {live.error && <p role="alert">{live.error}</p>}
        {existingGate && <p role="status">Existing GATE: {existingGate.hardwareId} — {existingGate.active?'Active':'Inactive'} — UUID {existingGate.serviceUuid||'Identity missing'}. A second gate cannot be registered, even when the existing gate is inactive. Review its existing record; registration history is retained.</p>}
        {gateRegistration.error && <p role="alert">{gateRegistration.error}</p>}
        <DataTable
          loading={live.loading}
          columns={columns}
          data={filteredBeacons}
          rowKey="id"
          caption="BLE beacons"
          minWidth={1000}
          emptyMessage="No beacons match this search."
        />
        <div className="sz-toolbar"><ActionButton variant="secondary" disabled={offset===0||saving} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous</ActionButton><span>Registrations {offset+1}–{offset+beacons.length}</span><ActionButton variant="secondary" disabled={beacons.length<25||saving} onClick={()=>setOffset(n=>n+25)}>Next</ActionButton></div>
      </main>

      <Footer />

      {/* Single beacon location */}
      {modalLayers.map(layer=>{const modal=layer.value;const selectedBeacon=beacons.find(beacon=>beacon.id===modal?.beaconId);return <Fragment key={layer.id}>
      {modal?.type === 'map' && selectedBeacon && (
        <BeaconModal
          key={`map-${selectedBeacon.id}`}
          title={`Beacon Location: ${selectedBeacon.name}`}
          className="sz-map-modal"
          busy={saving}
          onClose={closeModal}
        >
          <div className="sz-beacon-summary">
            <p>
              Zone: <strong>{selectedBeacon.kind}</strong>
            </p>

            <p>
              Spot: <strong>{selectedBeacon.location}</strong>
            </p>

            <p>
              Status: <BeaconStatus status={selectedBeacon.active?'Active':'Inactive'} />
            </p>
          </div>

          <p className="sz-demo-note">
            This is the saved beacon location, not a live GPS position.
          </p>

          <TechnicalDetails title="Technical setup for the project owner">
            <p>Beacon ID: <strong>{selectedBeacon.hardwareId}</strong></p>
            <p>Service UUID: <code>{selectedBeacon.serviceUuid||'Identity required'}</code></p>
            <p>Copy these values into BEACON_ID and BEACON_SERVICE_UUID in firmware/ChildGuard_Beacon/ChildGuard_Beacon.ino. Select your existing ESP32-C3 board profile and NimBLE-Arduino 2.x, then upload to this fixed beacon. The UUID must appear in the primary advertisement, not only the scan response.</p>
            <p>Verify the advertised service UUID with a passive BLE scanner, then check the wearable’s BEACON_CONFIG_APPLIED and BEACON_STATE messages and fresh observations here. Registration alone does not flash hardware. Do not change the existing gate UUID.</p>
          </TechnicalDetails>
          <div className="sz-map-preview">
            <MapPin size={30} aria-hidden="true" />
            <strong>{selectedBeacon.location}</strong>

            {selectedBeacon.lat != null &&
              selectedBeacon.lng != null && (
                <span>
                  {selectedBeacon.lat}, {selectedBeacon.lng}
                </span>
              )}
          </div>

          <div className="sz-modal-actions">
            <ActionButton
              variant="secondary"
              onClick={closeModal}
            >
              Close
            </ActionButton>
          </div>
        </BeaconModal>
      )}

      {/* All beacon locations */}
      {modal?.type === 'all-map' && (
        <BeaconModal
          key="all-map"
          title="All BLE Beacon Locations"
          className="sz-global-map-modal"
          busy={saving}
          onClose={closeModal}
        >
          <p className="sz-demo-note">
            These are saved beacon locations. To manage the GPS boundary, open GPS Safe Area.
          </p>

          <div className="sz-location-list">
            {beacons.map((beacon) => (
              <button
                type="button"
                key={beacon.id}
                className={
                  `sz-location-entry ${
                    !beacon.active
                      ? 'sz-map-marker--inactive'
                      : ''
                  }`
                }
                onClick={() =>
                  setModal({
                    type: 'map',
                    beaconId: beacon.id,
                  })
                }
                aria-label={`View ${beacon.name} location`}
              >
                <Radio size={16} aria-hidden="true" />

                <span>
                  {beacon.hardwareId}
                  <small>{beacon.name} · {beacon.location}</small>
                </span>
              </button>
            ))}

            {beacons.length === 0 && (
              <p className="sz-map-empty">
                No beacons available.
              </p>
            )}
          </div>

          <div className="sz-map-legend">
            <span>
              <i className="sz-dot sz-dot--active" />
              Active
            </span>

            <span>
              <i className="sz-dot sz-dot--inactive" />
              Inactive
            </span>
          </div>

          <div className="sz-modal-actions">
            <ActionButton
              variant="secondary"
              onClick={closeModal}
            >
              Close Map
            </ActionButton>
          </div>
        </BeaconModal>
      )}

      {/* Add / edit beacon */}
      {['add', 'edit'].includes(modal?.type) && (
        <BeaconModal
          key={`${modal.type}-${modal.beaconId || 'new'}`}
          title={
            modal.type === 'edit'
              ? 'Edit Beacon Details'
              : 'Register Bluetooth Beacon'
          }
          busy={saving}
          onClose={closeModal}
        >
          <form onSubmit={handleSave}>
            {[['hardwareId','Beacon ID (required)'],['name','Beacon name (required)'],['location','Location / zone name (required)'],['description','Description (optional)'],['serviceUuid','Bluetooth service code (UUID, required)']].map(renderBeaconField)}
            <TechnicalDetails title="Bluetooth signal thresholds (advanced)"><p>Keep the registered settings unless the project owner has checked the physical beacon range.</p>{[['entryRssi','Nearby signal threshold (dBm)'],['exitRssi','Far-away signal threshold (dBm)'],...(formData.kind==='GATE'?[['attendanceRssi','Gate check-in signal threshold (dBm)']]:[])].map(renderBeaconField)}</TechnicalDetails>

            <p>The far-away threshold must be at least 3 dBm lower than the nearby threshold. Each beacon needs a unique Bluetooth code that matches the physical board. Ask the project owner before changing these settings.</p>
            <div className="sz-form-group"><label htmlFor="sz-kind">Beacon Type</label><select id="sz-kind" value={formData.kind} disabled={saving||modal.type==='edit'||!gateRegistration.data||!!gateRegistration.error} onChange={event=>updateField('kind',event.target.value)}><option value="DANGER_ZONE">Danger zone</option><option value="GATE" disabled={!!existingGate}>School Gate{existingGate?' (already registered)':''}</option></select></div>
            {formData.kind==='GATE' && <p>The existing physical gate must broadcast {gateIdentity.serviceUuid}. Registration does not configure hardware. Verify the advertised UUID with a BLE scanner; do not substitute a generated UUID. Gate check-in signal threshold (dBm) must be at least the entry RSSI.</p>}
            <div className="sz-form-group">
              <FilterOption
                label="Status"
                disabled={saving||(formData.kind==='GATE'&&(modal.type==='add'||selectedBeacon?.active))}
                showLabel
                value={formData.active?'Active':'Inactive'}
                onChange={(value) =>
                  updateField('active',value==='Active')
                }
                options={[
                  { value: 'Active', label: 'Active' },
                  { value: 'Inactive', label: 'Inactive' },
                ]}
              />
            </div>

            {formError && (
              <p className="sz-form-error" role="alert">
                {formError}
              </p>
            )}

            <div className="sz-modal-actions">
              <ActionButton
                variant="secondary"
                onClick={closeModal}
              >
                Cancel
              </ActionButton>

              <ActionButton variant="primary" type="submit" disabled={saving}>
                {saving?'Saving…':'Save Beacon'}
              </ActionButton>
            </div>
          </form>
        </BeaconModal>
      )}


      </Fragment>;})}
    </div>
  );
}
