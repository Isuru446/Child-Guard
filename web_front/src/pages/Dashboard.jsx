import ChildLocationPicker from '../components/ChildLocationPicker';
import {attendanceChartData,attendanceDecisionStates} from '../components/attendance-chart-data';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  AlertTriangle,
  Bell,
  Bus,
  ChevronRight,
  FileText,
  GraduationCap,
  MapPinned,
  Radio,
  Users,
  Watch,
} from 'lucide-react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import Topbar from '../components/Topbar';
import StatCard from '../components/StatCard';
import FilterOption from '../components/FilterOption';
import ActionButton from '../components/ActionButton';
import LocationMap from '../components/LocationMap';
import Footer from '../components/Footer';

import { api } from '../lib/api';
import { createMonitoringPoller } from '../lib/monitoring-poller';
import { monitoringEvents } from '../lib/monitoring-events';
import { useMonitoringRead } from '../lib/use-monitoring-read';
import { dashboardAttendance as getCounts, dashboardDaily } from '../lib/dashboard-attendance';

import {
  formatDate,
  formatMonth,
  getMonthDates,
  getTodayKey,
} from '../data/attendanceMockData';

import '../style/Dashboard.css';

const attendanceKeys={PRESENT:'present',CHECKIN_PENDING:'pending',ABSENT:'absent',CHECKED_OUT:'checkedOut'};

function loadData() { return {children:[],attendance:[],teachers:[],devices:[],buses:[],alerts:[],geofences:[],beacons:[],requests:[],counts:null}; }

function _priority(item) {
  const category = String(item.category || '').toLowerCase();
  const severity = String(item.severity || '').toLowerCase();

  if (
    ['sos', 'danger zone', 'dangerzone', 'tamper', 'tamper loop', 'battery']
      .includes(category) ||
    ['high', 'critical', 'immediate'].includes(severity)
  ) {
    return 'high';
  }

  return ['medium', 'moderate'].includes(severity)
    ? 'medium'
    : 'low';
}

function timestamp(item) {
  const value = item.createdAt ?? item.timestamp;

  if (typeof value === 'number') {
    return value < 100000000000 ? value * 1000 : value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/* Supports lat/lng fields and "latitude, longitude" strings. */
function coordinates(item) {
  if (
    item.lat !== undefined &&
    item.lng !== undefined &&
    item.lat !== null &&
    item.lng !== null &&
    item.lat !== '' &&
    item.lng !== ''
  ) {
    return { lat: item.lat, lng: item.lng };
  }

  const center = item.centerCoordinates;

  if (Array.isArray(center) && center.length >= 2) {
    return { lat: center[0], lng: center[1] };
  }

  if (center && typeof center === 'object') {
    return {
      lat: center.lat ?? center.latitude,
      lng: center.lng ?? center.longitude,
    };
  }

  if (typeof center === 'string') {
    const values = center.match(/-?\d+(?:\.\d+)?/g);

    if (values?.length >= 2) {
      return { lat: Number(values[0]), lng: Number(values[1]) };
    }
  }

  return { lat: null, lng: null };
}

function radiusInMeters(value) {
  if (typeof value === 'number') return value;

  const text = String(value || '').trim();
  const number = Number.parseFloat(text.replace(/,/g, ''));

  if (!Number.isFinite(number)) return 0;

  return /km/i.test(text) ? number * 1000 : number;
}

function validLocation(item) {
  return (
    [item.lat, item.lng].every(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== '' &&
        Number.isFinite(Number(value)),
    ) &&
    Math.abs(Number(item.lat)) <= 90 &&
    Math.abs(Number(item.lng)) <= 180
  );
}

function AttendanceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const row = payload[0].payload;

  return (
    <div className="dashboard-tooltip">
      <strong>{formatDate(row.date)}</strong>

      {payload.map((item) => (
        <span key={item.dataKey}>
          {item.name}<b>{item.value}</b>
        </span>
      ))}

    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [data, setData] = useState(loadData);
  const [backendError,setBackendError]=useState('');
  const safety=useMonitoringRead('/api/v1/admin/safety-summary');
  const zones=useMonitoringRead('/api/v1/safe-zones');
  const geofences=useMemo(()=>zones.data?.configurationAvailable===true?(zones.data.zones??[]).map(zone=>({...zone,lat:zone.latitude,lng:zone.longitude,radius:zone.radiusM,status:zone.active?'Configured active':'Inactive'})):[],[zones.data]);
  const [today, setToday] = useState(getTodayKey);

  const [month, setMonth] = useState(
    () => getTodayKey().slice(0, 7),
  );

  const daily=useMonitoringRead(`/api/v1/attendance?management=true&view=roster&day=${today}&limit=1`);

  const [statusFilter, setStatusFilter] = useState('both');
  const [mapFilter, setMapFilter] = useState('all');

  useEffect(() => {
    const driver=createMonitoringPoller({intervalMs:60000,read:({signal})=>api(`/api/v1/admin/overview?month=${month}`,{signal}),onData:value=>{setToday(getTodayKey());setData({...loadData(),...value});setBackendError('');},onError:error=>setBackendError(error.message)});
    const refresh=()=>driver.refresh(),reconcile=()=>driver.reconcile();driver.start();
    const unsubscribe=monitoringEvents.subscribe(event=>{if(event.topics?.includes('attendance'))driver.invalidate();});
    window.addEventListener('approvedRegistrationUpdated',refresh);
    document.addEventListener('visibilitychange',reconcile);window.addEventListener('online',reconcile);window.addEventListener('offline',reconcile);
    return()=>{unsubscribe();driver.dispose();window.removeEventListener('approvedRegistrationUpdated',refresh);document.removeEventListener('visibilitychange',reconcile);window.removeEventListener('online',reconcile);window.removeEventListener('offline',reconcile);};
  },[month]);

  const records = useMemo(() => {
    const ids = new Set(
      data.children.map((child) =>
        String(child.childId ?? child.id ?? ''),
      ),
    );

    const unique = new Map();

    data.attendance.forEach((record) => {
      const id = String(record.childId);

      if (
        ids.has(id) &&
        /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
        record.date <= today &&
        ['Present','PRESENT','NOT_CHECKED_IN','CHECKIN_PENDING','CHECKED_OUT','ABSENT'].includes(record.status)
      ) {
        unique.set(`${record.date}:${id}`, record);
      }
    });

    return [...unique.values()];
  }, [data.children, data.attendance, today]);

  const byDate = useMemo(() => {
    const grouped = new Map();

    records.forEach((record) => {
      if (!grouped.has(record.date)) grouped.set(record.date, []);
      grouped.get(record.date).push(record);
    });

    return grouped;
  }, [records]);

  const todayCounts = dashboardDaily(daily.data?.summary);

  const monthCounts = getCounts(
    records.filter((record) => record.date.startsWith(month)),
  );

  const chartData = getMonthDates(month)
    .filter((date) => date <= today)
    .map((date) => ({
      date,
      label: Number(date.slice(-2)),
      ...getCounts(byDate.get(date) || []),
    }));

  const dailyChart=attendanceChartData(daily.data?.summary,true);
  const pieData=dailyChart.slices;
  const pieLegend=todayCounts?dailyChart.legend:[];

  const combinedLocations = useMemo(() => [
    ...geofences.map((zone) => ({
      id: zone.id,
      name: zone.zoneName || zone.name,
      type: 'geofence',
      ...coordinates(zone),
      radius: radiusInMeters(zone.radius),
      description: [
        zone.zoneType,
        zone.status,
        zone.alertOn ? `Trigger: ${zone.alertOn}` : '',
      ].filter(Boolean).join(' · '),
    })),

    ...data.beacons.map((beacon) => ({
      id: beacon.id,
      name: beacon.beaconName || beacon.name,
      type: 'beacon',
      ...coordinates(beacon),
      description: [
        beacon.zoneArea,
        beacon.location,
        beacon.status,
      ].filter(Boolean).join(' · '),
    })),
  ].filter(validLocation), [
    geofences,
    data.beacons,
  ]);

  const filteredLocations = combinedLocations.filter(
    (item) => mapFilter === 'all' || item.type === mapFilter,
  );

  const busLocations = useMemo(
    () => data.buses.map((bus) => ({
      id: bus.id,
      name: bus.vehicleNo || bus.id,
      type: 'bus',
      ...coordinates(bus),
      description: [
        bus.routeName,
        bus.driverName ? `Driver: ${bus.driverName}` : '',
      ].filter(Boolean).join(' · '),
    })).filter(validLocation),
    [data.buses],
  );

  const _messages = useMemo(
    () => data.alerts
      .map((item, index) => ({
        ...item,
        originalIndex: index,
        sortTime: timestamp(item),
      }))
      .sort((first, second) => {
        if (first.sortTime !== null && second.sortTime !== null) {
          return second.sortTime - first.sortTime;
        }

        if (first.sortTime !== null) return -1;
        if (second.sortTime !== null) return 1;

        return first.originalIndex - second.originalIndex;
      })
      .slice(0, 3),
    [data.alerts],
  );

  const cards = [
    { title: 'Children', value: data.counts?.children ?? 'Unavailable', icon: Users, color: 'blue', path: '/students' },
    { title: 'Teachers', value: data.counts?.teachers ?? 'Unavailable', icon: GraduationCap, color: 'blue', path: '/teachers' },
    {
      title: 'Wearable Devices',
      value: data.counts?.devices ?? 'Unavailable',
      icon: Watch,
      color: 'blue',
      subtitle: data.counts ? `${data.counts.onlineDevices} online` : 'Unavailable',
      path: '/devices',
    },
    {
      title: 'Transport Buses',
      value: 'Unavailable',
      icon: Bus,
      color: 'blue',
      subtitle: 'Transport service not connected',
      path: '/transport',
    },
    { title: 'Alerts', value: safety.data?.alerts ?? data.counts?.alerts ?? 'Unavailable', icon: AlertTriangle, color: 'red', path: '/alerts' },
    { title: 'Pending Requests', value: data.counts?.pendingRequests ?? 'Unavailable', icon: FileText, color: 'yellow', path: '/registration-approval' },
    { title: 'Geofence', value: zones.data?.configurationAvailable===true?geofences.length:'Unavailable', icon: MapPinned, color: 'blue', path: '/geofence' },
    {
      title: 'BLE Beacons',
      value: data.counts?.beacons ?? 'Unavailable',
      icon: Radio,
      color: 'blue',
      subtitle: data.counts ? `${data.counts.activeBeacons} active` : 'Unavailable',
      path: '/safe-zones',
    },
  ];

  const openAttendance = () => navigate('/attendance');

  const chartKey = (event) => {
    if (event.target !== event.currentTarget) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAttendance();
    }
  };

  return (
    <div className="main-dashboard">
      <Topbar />

      <main className="dashboard-content">
        {backendError&&<p role="alert">{backendError}</p>}
        {safety.error&&<p role="alert">{safety.error}</p>}
        {daily.error&&<p role="alert">{daily.error}</p>}{zones.error&&<p role="alert">{zones.error}</p>}
        {data.truncated&&<p>This chart shows a limited set of records. Summary totals include all records.</p>}
        <p>View today's attendance, registered children, wearable devices and safety alerts.</p>
        <section className="dashboard-cards" aria-label="Dashboard statistics">
          {cards.map(({ path, ...card }) => (
            <StatCard
              key={card.title}
              {...card}
              compact
              iconPosition="left"
              onClick={() => navigate(path)}
            />
          ))}
        </section>

        <div className="dashboard-attendance-grid">
          <section className="dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <h2>Monthly Attendance</h2>
                <p>{formatMonth(month)}</p>
              </div>

              <label className="dashboard-month-picker">
                <span>Month</span>
                <input
                  type="month"
                  value={month}
                  max={today.slice(0, 7)}
                  onChange={(event) => {
                    const value = event.target.value;

                    if (
                      /^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
                      value <= today.slice(0, 7)
                    ) {
                      setMonth(value);
                    }
                  }}
                />
              </label>
            </div>

            <div className="dashboard-chart-toolbar">
              <FilterOption
                label="Attendance filter"
                mode="tabs"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'both', label: 'All Statuses' },
                  ...attendanceDecisionStates.map(state=>({value:attendanceKeys[state.key],label:state.name})),
                ]}
              />

<span className="dashboard-month-rate">Recorded attendance decisions</span>
            </div>

            {monthCounts.total > 0 ? (
              <div className="dashboard-chart-scroll">
                <div
                  className="dashboard-bar-chart dashboard-chart-link"
                  role="link"
                  tabIndex={0}
                  aria-label="Open Attendance Overview"
                  onClick={openAttendance}
                  onKeyDown={chartKey}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 10, right: 15, left: 15, bottom: 35 }}
                      barGap={4}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e2e8f0"
                      />

                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        label={{
                          value: 'Date',
                          position: 'insideBottom',
                          offset: -20,
                        }}
                      />

                      <YAxis
                        allowDecimals={false}
                        width={60}
                        tick={{ fontSize: 11 }}
                        label={{
                          value: 'Number of students',
                          angle: -90,
                          position: 'insideLeft',
                          style: { textAnchor: 'middle', fontSize: 12 },
                        }}
                      />

                      <Tooltip content={<AttendanceTooltip />} />
                      <Legend verticalAlign="top" height={35} />

                      {attendanceDecisionStates.filter(state=>statusFilter==='both'||statusFilter===attendanceKeys[state.key]).map(state=><Bar key={state.key} dataKey={attendanceKeys[state.key]} name={state.name} fill={state.color} radius={[4,4,0,0]} maxBarSize={24}/>)}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="dashboard-chart-empty">
                No attendance records for this month.
              </div>
            )}

            <div className="dashboard-panel-footer">
              <ActionButton
                variant="secondary"
                icon={ChevronRight}
                onClick={openAttendance}
              >
                Attendance Details
              </ActionButton>
            </div>
          </section>

          <section className="dashboard-panel dashboard-daily-panel">
            <div className="dashboard-panel__header">
              <div>
                <h2>Daily Attendance</h2>
                <p>{formatDate(today)}</p>
              </div>
            </div>

            <div className="dashboard-present-rate">
              <strong>
                {todayCounts?.rate == null ? '—' : `${todayCounts.rate}%`}
              </strong>
              <span>Marked Present / registered children</span>
            </div>

            {dailyChart.complete && dailyChart.total > 0 ? (
              <div
                className="dashboard-pie-chart dashboard-chart-link"
                role="link"
                tabIndex={0}
                aria-label="Open daily attendance details"
                onClick={openAttendance}
                onKeyDown={chartKey}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="55%"
                      outerRadius="82%"
                      paddingAngle={2}
                    >
                      {pieData.map((item) => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="dashboard-pie-empty">
                {daily.loading?'Loading daily attendance...':daily.error||!dailyChart.complete?'Daily attendance is unavailable.':'No attendance records available today.'}
              </div>
            )}

            <div className="dashboard-pie-legend">
              {pieLegend.map((item) => (
                <div key={item.name}>
                  <i style={{ background: item.color }} />
                  <span>{item.name}</span>
                  <strong>{item.value??'Unavailable'}</strong>
                </div>
              ))}

            </div>
            {dailyChart.complete&&dailyChart.remainder>0&&<p className="ao-muted">Grey shows children without an attendance decision.</p>}
          </section>
        </div>

        <div className="dashboard-locations-grid">
          <section className="dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <h2>Children & Safety Zones</h2>
                <p>Saved safe areas and beacon locations. Open Children to view recorded child GPS.</p>
              </div>
            </div>

            <div className="dashboard-map-toolbar">
              <FilterOption
                label="Map locations"
                mode="tabs"
                value={mapFilter}
                onChange={setMapFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'child', label: 'Children' },
                  { value: 'geofence', label: 'GPS Safe Area' },
                  { value: 'beacon', label: 'Bluetooth Beacons' },
                ]}
              />
            </div>

            {mapFilter==='child'?<ChildLocationPicker initiallyOpen/>:<LocationMap
              locations={filteredLocations}
              label="Children, geofence boundaries and BLE beacon locations"
            />}

            <div className="dashboard-map-legend">
              <span><i className="child" /> Children</span>
              <span><i className="geofence" /> Geofence</span>
              <span><i className="beacon" /> BLE Beacons</span>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <h2>Bus Locations</h2>
                <p>{busLocations.length} recorded locations</p>
              </div>

              <ActionButton
                variant="secondary"
                icon={Bus}
                onClick={() => navigate('/transport')}
              >
                Transport
              </ActionButton>
            </div>

            <LocationMap
              locations={busLocations}
              label="Recorded bus locations"
            />

            <div className="dashboard-map-legend">
              <span><i className="bus" /> Transport buses</span>
            </div>
          </section>
        </div>

        
      </main>

      <Footer />
    </div>
  );
}
