import { useEffect, useState } from 'react';
import { privatePhoto } from '../lib/api';
export default function ProfilePhoto({ id, version }) {
 const [photo, setPhoto] = useState(null);
 const key=`${id??''}:${version??''}`;
 const src=photo?.key===key?photo.src:'';
 useEffect(() => { let live = true; let objectUrl; if(id) privatePhoto(id).then(url => {objectUrl=url;if(live)setPhoto({key,src:url});else URL.revokeObjectURL(url);}).catch(()=>{});return()=>{live=false;if(objectUrl)URL.revokeObjectURL(objectUrl);}; },[id,key]);
 return src && id ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="Applicant profile" width="96" height="96" /></a> : <span>Default avatar</span>;
}
