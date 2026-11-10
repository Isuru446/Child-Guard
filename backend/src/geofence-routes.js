import { fail } from './events.js';
import { zoneLimits } from './geofence-foundation.js';
import { readPrototypeZones,savePrototypeZone } from './prototype-geofence.js';
export const geofenceReadiness=Object.freeze({configurationAvailable:false,monitoringAvailable:false,zones:null,scope:'CENTER_PROPOSAL',limits:zoneLimits,reason:'SCHEMA_AND_GPS_EVIDENCE_NOT_APPROVED'});
export function mountGeofenceFoundation(app,{db,asyncRoute}){
 const admin=req=>{if(req.authTransport!=='admin-cookie'||req.user?.role!=='ADMIN'||!req.user.centerId)throw fail(403,'FORBIDDEN','Center administrator cookie session required');};
 app.get('/api/v1/safe-zones',asyncRoute(async(req,res)=>{admin(req);res.set('Cache-Control','no-store').json({data:await readPrototypeZones(db,req.user.centerId)});}));
 app.put('/api/v1/safe-zones',asyncRoute(async(req,res)=>{admin(req);res.json({data:await savePrototypeZone(db,req,req.body)});}));
 // Existing cookie middleware performs Origin/CSRF/session admission first.
 // No activation flag or repository fallback exists; no model is accessed.
 for(const path of ['/api/v1/safe-zones','/api/v1/safe-zones/:id'])for(const method of ['post','patch','put','delete'])app[method](path,asyncRoute(async(req,res)=>{admin(req);throw fail(503,'GEOFENCE_UNAVAILABLE','Use the authorized center safe-zone configuration endpoint after migration');}));
}
