import {googleMapsUrl} from '../lib/gps-location';
import './ChildLocation.css';
export default function GoogleMapsLink({latitude,longitude,historical=false}){
 const href=googleMapsUrl(latitude,longitude);
 return href?<a className="cg-google-maps-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={historical?'Open historical location in Google Maps':'Open in Google Maps'}>Open in Google Maps</a>:null;
}
