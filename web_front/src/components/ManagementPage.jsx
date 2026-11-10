import WearableAssignments from './WearableAssignments';
import { useCallback, useEffect, useState } from 'react';
import { Users, Watch } from 'lucide-react';
import Topbar from './Topbar';
import Footer from './Footer';
import StatCard from './StatCard';
import DataTable from './DataTable';
import ActionButton from './ActionButton';
import { api } from '../lib/api';
import ProfilePhoto from './ProfilePhoto';
import ChildManagementPanel from './ChildManagementPanel';
import { PageHeading } from './ManagementUI';
import '../style/RegistrationApproval.css';
import '../style/Children.css';
import '../style/ChildrenIntegration.css';

export default function ManagementPage({ kind }) {
 const [data,setData]=useState({users:[],children:[],devices:[],audits:[]}),[search,setSearch]=useState(''),[role,setRole]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [assignmentRevision,setAssignmentRevision]=useState(0);
 const load=useCallback(async()=>{setBusy(true);try{setData(await api('/api/v1/admin/management'));setError('');}catch(e){setError(e.message);}finally{setBusy(false);}},[]);
 const assignmentsChanged=()=>{setAssignmentRevision(value=>value+1);return load();};
 useEffect(()=>{const timer=window.setTimeout(()=>{load();},100);return()=>window.clearTimeout(timer);},[load]);
 async function status(user){if(!window.confirm(`${user.active?'Suspend':'Activate'} ${user.username}?`))return;try{await api(`/api/v1/admin/users/${user.id}/status`,{method:'PATCH',body:JSON.stringify({active:!user.active})});await load();}catch(e){setError(e.message);}}
 async function changeRole(user){const role=user.role==='PARENT'?'TEACHER':'PARENT';if(!window.confirm(`Grant ${role} access within this center to ${user.username}? Verify employment/guardianship first.`))return;try{await api(`/api/v1/admin/users/${user.id}/role`,{method:'PATCH',body:JSON.stringify({role,roleChangeAcknowledged:true})});await load();}catch(e){setError(e.message);}}
 const users=data.users.filter(r=>(!role||r.role===role)&&`${r.username} ${r.profile?.fullName||''}`.toLowerCase().includes(search.toLowerCase()));
 return <div className="cm-page"><Topbar hideTitle/><main className="cm-container cg-admin-content"><PageHeading title={kind==='children'?'Children Management':'Parents and Teachers'}></PageHeading>
 <p>View children's details, check their Parents and manage wearable assignments.</p>
 <div className="cm-stats-grid"><StatCard title="Registered Children" value={data.children.length} icon={Users}/><StatCard title="Parents / Guardians Linked" value={data.children.reduce((count,child)=>count+child.guardians.length,0)} icon={Users} color="green"/><StatCard title="Wearables Assigned" value={data.devices.filter(d=>d.assignments.some(a=>!a.endedAt)).length} icon={Watch} color="purple"/></div>{(data.children.length>=100||data.devices.length>=100)&&<p className="cg-field-help">Summary cards show the first 100 records. Use the lists to find more records.</p>}
 {error&&<p role="alert" className="registration-error">{error}</p>}
 {kind!=='children'&&<div className="registration-tools"><label>Search<input value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Role<select value={role} onChange={e=>setRole(e.target.value)}><option value="">All</option><option>PARENT</option><option>TEACHER</option></select></label><ActionButton disabled={busy} onClick={load}>Refresh</ActionButton></div>}
 {kind==='children'?<ChildManagementPanel onChanged={load} refreshKey={assignmentRevision}/>:<DataTable loading={busy} data={users} columns={[{key:'photo',label:'Photo',render:r=><ProfilePhoto id={r.profile?.photo?.id} version={r.profile?.photo?.createdAt}/>},{key:'username',label:'Username'},{key:'profile',label:'Name',render:r=>r.profile?.fullName||'Profile not supplied'},{key:'role',label:'Role'},{key:'active',label:'Status',render:r=>r.active?'ACTIVE':'SUSPENDED'},{key:'guardians',label:'Approved children',render:r=>r.guardians.length},{key:'actions',label:'Actions',render:r=><><ActionButton onClick={()=>status(r)} disabled={busy}>{r.active?'Suspend':'Activate'}</ActionButton><ActionButton onClick={()=>changeRole(r)} disabled={busy}>Review role change</ActionButton></>}]}/>}
 <WearableAssignments onChanged={assignmentsChanged}/><details className="cg-panel"><summary>Recent center audit history</summary><DataTable data={data.audits} columns={[{key:'action',label:'Action'},{key:'resourceId',label:'Resource'},{key:'createdAt',label:'Time',render:r=>new Date(r.createdAt).toLocaleString()}]}/>
 </details></main><Footer/></div>;
}
