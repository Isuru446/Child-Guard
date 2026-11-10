import { useState } from 'react';
import { MapPin } from 'lucide-react';
import ActionButton from './ActionButton';
import LocationMap from './LocationMap';
import GoogleMapsLink from './GoogleMapsLink';

export default function RecordedLocationPreview({latitude,longitude,name,radius,label='Recorded location preview',previewLabel='Preview recorded location',showGoogle=true}) {
  const [open,setOpen]=useState(false);
  const valid=typeof latitude==='number'&&Number.isFinite(latitude)&&Math.abs(latitude)<=90&&typeof longitude==='number'&&Number.isFinite(longitude)&&Math.abs(longitude)<=180;
  return <div className="recorded-location-preview"><div className="recorded-location-caption"><MapPin size={20} aria-hidden="true"/><span>{valid?`${latitude}, ${longitude}`:'No valid coordinates supplied'}</span>{valid&&<><ActionButton variant="secondary" onClick={()=>setOpen(value=>!value)}>{open?'Hide map':previewLabel}</ActionButton>{showGoogle&&<GoogleMapsLink latitude={latitude} longitude={longitude} historical/>}</>}</div>{open&&valid&&<LocationMap label={label} preserveView locations={[{id:'recorded-point',name,lat:latitude,lng:longitude,type:radius?'geofence':'child',radius,description:'Recorded configuration or evidence; not a live safety assessment.'}]}/>}</div>;
}
