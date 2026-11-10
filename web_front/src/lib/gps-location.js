export function validGps(latitude,longitude){
 return typeof latitude==='number'&&Number.isFinite(latitude)&&Math.abs(latitude)<=90&&typeof longitude==='number'&&Number.isFinite(longitude)&&Math.abs(longitude)<=180;
}
export function googleMapsUrl(latitude,longitude){
 if(!validGps(latitude,longitude))return null;
 const url=new URL('https://www.google.com/maps/search/');
 url.search=new URLSearchParams({api:'1',query:`${latitude},${longitude}`}).toString();return url.href;
}
export const gpsTime=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Not recorded';
export const gpsLabel=status=>({GPS_FIX:'GPS position recorded',GPS_NO_FIX:'Waiting for GPS fix',GPS_NO_SERIAL:'GPS receiver is not reporting',NOT_REPORTED:'No recent GPS status report'})[status]||'GPS status unavailable';
export function freshLocation(point,device,status,now,staleAfterMs=60000){
 const age=now-Date.parse(point?.observedAt),seenAge=now-Date.parse(device?.lastSeen);
 return validGps(point?.latitude,point?.longitude)&&device?.active===true&&device.connectionState==='ONLINE'&&status==='GPS_FIX'&&point.state==='RECENT'&&Number.isFinite(age)&&age>=0&&age<=staleAfterMs&&Number.isFinite(seenAge)&&seenAge>=0&&seenAge<=60000;
}
