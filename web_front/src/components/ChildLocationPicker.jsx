import {useState} from 'react';
import ActionButton from './ActionButton';
import ChildLocation from './ChildLocation';
import {useMonitoringRead} from '../lib/use-monitoring-read';
export default function ChildLocationPicker({initiallyOpen=false}){
 const [open,setOpen]=useState(initiallyOpen),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[selected,setSelected]=useState('');
 const query=new URLSearchParams({limit:'25',offset:String(offset),...(search.trim()?{search:search.trim()}:{})});
 const read=useMonitoringRead(`/api/v1/admin/children?${query}`,{enabled:open,intervalMs:15000});
 const rows=Array.isArray(read.data)?read.data:[],child=rows.find(c=>c.id===selected);
 function page(value){setOffset(value);setSelected('');}
 return <section className="cg-panel"><h2>Child Location</h2><ActionButton variant="secondary" onClick={()=>setOpen(v=>!v)}>{open?'Hide child locations':'View child locations'}</ActionButton>{open&&<>
 <label>Search children<input value={search} onChange={e=>{setSearch(e.target.value);page(0);}}/></label>
 {read.loading?<p role="status">Loading children...</p>:read.error?<p role="alert">Unable to load children. {read.error}</p>:<><label>Child<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select child</option>{rows.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{!rows.length&&<p>No matching children.</p>}</>}
 <div className="cg-pagination"><ActionButton variant="secondary" disabled={read.loading||offset===0} onClick={()=>page(Math.max(0,offset-25))}>Previous children</ActionButton><ActionButton variant="secondary" disabled={read.loading||rows.length<25} onClick={()=>page(offset+25)}>Next children</ActionButton></div>
 {child&&<ChildLocation key={child.id} childId={child.id} childName={child.name}/>}
 </>}</section>;
}
