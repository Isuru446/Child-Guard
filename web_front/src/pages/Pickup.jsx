import { pickupLabel } from '../lib/ui-language';
import ModalCloseButton from '../components/ModalCloseButton';
import useDialogAccessibility, {canDismissDialog} from '../hooks/useDialogAccessibility';
import {
  useRef,
  useState,
} from 'react';

import {
  Clock,
  Phone,
  ShieldCheck,
} from 'lucide-react';

import Topbar from '../components/Topbar';
import StatCard from '../components/StatCard';
import Footer from '../components/Footer';
import { PageHeading } from '../components/ManagementUI';
import SearchBar from '../components/SearchBar';
import DataTable from '../components/DataTable';
import ActionButton from '../components/ActionButton';

import { useMonitoringRead } from '../lib/use-monitoring-read';
import { getTodayKey } from '../lib/attendanceDates';
import { StatusPill } from '../components/ManagementUI';

import '../style/Pickup.css';

const statuses=['PENDING','COMPLETED','CANCELLED','EXPIRED','REJECTED'];
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Colombo'}):'Not recorded';
const photoUrl=record=>record?.photoAvailable?`/api/v1/admin/pickups/${encodeURIComponent(record.id)}/photo`:null;
const statusTone=status=>status==='COMPLETED'?'success':status==='PENDING'?'warning':'muted';

function Avatar({ src, name = '', large = false }) {
  const [failedSource, setFailedSource] = useState(null);


  const initials = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  const classes = [
    'ap-avatar',
    large ? 'ap-avatar--large' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (src && failedSource !== src) {
    return (
      <img
        src={src}
        alt={`${name} profile`}
        className={classes}
        onError={() => setFailedSource(src)}
      />
    );
  }

  return (
    <span
      className={`${classes} ap-avatar--fallback`}
      aria-hidden="true"
    >
      {initials || '—'}
    </span>
  );
}

function ChildDetailsModal({ record, loading, error, onClose }) {
  const modalRef = useRef(null);


  useDialogAccessibility(modalRef, onClose);

  const details = record ? [
    ['Pickup reference', record.id],
    ['Child ID', record.child?.id],
    ['Child Name', record.child?.name],
    ['Pickup person', record.person?.fullName],
    ['Relationship', record.person?.relationship],
    ['Phone Number', record.person?.phone],
    ['Address', record.person?.address],
    ['Requesting Parent', record.requestedBy?.username],
    ['Status', pickupLabel(record.status)],
    ['Requested', time(record.createdAt)],
    ['Pickup window starts', time(record.windowStart)],
    ['Pickup window ends', time(record.windowEnd)],
    ['Expires', time(record.expiresAt)],
    ['Code verified by', record.verifiedBy?.username],
    ['Verification time', time(record.verifiedAt)],
    [record.status==='COMPLETED'?'Confirming Teacher':'Reviewing account', record.reviewedBy?.username],
    ['Completed at', time(record.completedAt)],
    ['Reason', record.reason],
  ] : [];

  return (
    <div
      className="ap-modal-overlay"
      onClick={event=>{if(event.target===event.currentTarget&&canDismissDialog(modalRef.current)){event.stopPropagation();onClose();}}}
    >
      <section
        ref={modalRef}
        className="ap-modal-content"
        role="dialog" data-dialog-size="medium"
        aria-modal="true"
        aria-labelledby="ap-child-details-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ap-modal-header">
          <h3 id="ap-child-details-title">
            Pickup Request Details
          </h3>

          <ModalCloseButton onClick={onClose} />
        </div>

        {loading?<p role="status">Loading pickup details...</p>:error?<p role="alert">Pickup details unavailable. {error}</p>:record&&<><div className="ap-profile-summary">
          <Avatar
            src={photoUrl(record)}
            name={record.person?.fullName}
            large
          />

          <h4>{record.person?.fullName||'Name not recorded'}</h4>
          <p>{record.child?.name}</p>
        </div>

        <dl className="ap-details-list">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>

              <dd>
                {label === 'Phone Number' && value ? (
                  <a
                    href={`tel:${String(value).replace(
                      /[^\d+]/g,
                      ''
                    )}`}
                  >
                    {value}
                  </a>
                ) : (
                  value || '—'
                )}
              </dd>
            </div>
          ))}
        </dl></>}

        <div className="ap-modal-actions">
          <ActionButton
            variant="secondary"
            onClick={onClose}
          >
            Close
          </ActionButton>
        </div>
      </section>
    </div>
  );
}

export default function Pickup() {
  const [day,setDay]=useState(getTodayKey),[status,setStatus]=useState(''),[offset,setOffset]=useState(0),[searchTerm,setSearchTerm]=useState('');
  const [selectedPickupId,setSelectedPickupId]=useState(null);
  const query=new URLSearchParams({limit:'25',offset:String(offset),...(day?{day}:{}),...(status?{status}:{})});
  const read=useMonitoringRead(`/api/v1/admin/pickups?${query}`,{enabled:!selectedPickupId,intervalMs:15000,startDelay:150});
  const detail=useMonitoringRead(selectedPickupId?`/api/v1/admin/pickups/${encodeURIComponent(selectedPickupId)}`:'/api/v1/admin/pickups',{enabled:!!selectedPickupId,intervalMs:15000});
  const rows=read.data?.rows??[],summary=read.data?.summary;
  const needle=searchTerm.trim().toLowerCase();
  const filtered=rows.filter(r=>[r.id,r.child?.id,r.child?.name,r.person?.fullName,r.person?.phone,r.person?.address,r.personId,r.requestedBy?.username,r.reviewedBy?.username,r.status].some(value=>String(value??'').toLowerCase().includes(needle)));
  const columns=[
    {key:'id',label:'Pickup ID',className:'cg-table-id'},
    {key:'person',label:'Pickup Person',render:r=><div className="ap-person-info"><Avatar src={photoUrl(r)} name={r.person?.fullName}/><strong>{r.person?.fullName||'Not recorded'}</strong></div>},
    {key:'personId',label:'Person ID',className:'cg-table-nowrap'},
    {key:'phone',label:'Phone Number',render:r=>r.person?.phone?<a className="ap-phone" href={`tel:${r.person.phone.replace(/[^0-9+]/g,'')}`}><Phone size={14} aria-hidden="true"/>{r.person.phone}</a>:'Unavailable'},
    {key:'child',label:'Child Name',render:r=><button type="button" className="cg-table-link" onClick={()=>setSelectedPickupId(r.id)} aria-label={`View ${r.child?.name||'child'} information`}>{r.child?.name||'Unavailable'}</button>},
    {key:'time',label:'Pickup Time',render:r=><span className="ap-pickup-time"><Clock size={15} aria-hidden="true"/>{time(r.windowStart)}</span>},
    {key:'status',label:'Status',render:r=><StatusPill tone={statusTone(r.status)}>{pickupLabel(r.status)}</StatusPill>},
    {key:'parent',label:'Requesting Parent',render:r=>r.requestedBy?.username||'Unavailable'},
    {key:'teacher',label:'Confirming Teacher',render:r=>r.status==='COMPLETED'?r.reviewedBy?.username||'Unavailable':'Not completed'},
  ];
  return <div className="ap-page"><Topbar hideTitle/><main className="ap-container cg-admin-content">
    <PageHeading title="Authorized Pickup"></PageHeading>
    <div className="ap-summary-row"><div className="ap-stat-wrapper"><StatCard title={day===getTodayKey()?'Pickups Today':'Pickup Requests'} value={summary?.total??(read.loading?'...':'Unavailable')} icon={ShieldCheck} color="blue" iconPosition="left"/></div><div className="ap-search-wrapper"><SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search this page by person or child..." label="Search pickup records"/></div></div>
    <div className="registration-tools"><label>Pickup date<input type="date" value={day} max={getTodayKey()} onChange={e=>{setDay(e.target.value);setOffset(0);}}/></label><label>Pickup status<select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="">All statuses</option>{statuses.map(value=><option key={value} value={value}>{pickupLabel(value)}{summary?` (${summary[value]})`:''}</option>)}</select></label><ActionButton variant="secondary" onClick={()=>{setDay('');setOffset(0);}}>All dates</ActionButton><ActionButton variant="secondary" disabled={read.refreshing} onClick={read.refresh}>Refresh pickups</ActionButton></div>
    <p className="ao-muted">Only a Teacher can verify the code and confirm handover in the app. Search covers this page. Times use Sri Lanka time.</p>
    {read.error&&<p role="alert">Pickup records unavailable. {read.error} Try Refresh pickups. If records are still unavailable, ask the project owner to check the service.</p>}
    {read.paused&&<p role="status">Pickup refresh paused while hidden, offline or viewing details.</p>}
    {read.updatedAt&&<p className="ao-muted">Last updated: {time(read.updatedAt)}.</p>}
    <DataTable columns={columns} data={filtered} loading={read.loading} rowKey="id" caption="Recorded pickup requests" minWidth={1000} emptyMessage={read.error?'Pickup service unavailable.':'No matching pickup records in this view.'}/>
    <div className="cg-pagination"><ActionButton variant="secondary" disabled={read.loading||read.refreshing||!offset} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous pickups</ActionButton><span>Page {offset/25+1}</span><ActionButton variant="secondary" disabled={read.loading||read.refreshing||!read.data?.hasMore} onClick={()=>setOffset(n=>n+25)}>Next pickups</ActionButton></div>
  </main><Footer/>{selectedPickupId&&<ChildDetailsModal key={selectedPickupId} record={detail.data} loading={detail.loading} error={detail.error} onClose={()=>setSelectedPickupId(null)}/>}</div>;
}
