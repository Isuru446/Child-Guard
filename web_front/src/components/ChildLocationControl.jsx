import {useState} from 'react';
import ActionButton from './ActionButton';
import ChildLocation from './ChildLocation';
export default function ChildLocationControl({child}){
 const [open,setOpen]=useState(false);
 return <div><ActionButton variant="secondary" onClick={()=>setOpen(value=>!value)}>{open?'Hide location':'View Location'}</ActionButton>{open&&<ChildLocation key={child.id} childId={child.id} childName={child.name}/>}</div>;
}
