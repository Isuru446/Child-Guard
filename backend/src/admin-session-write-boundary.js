// Request-local adapter for the server-selected domain DB input. Legacy mobile,
// public registration and device authority retain their original transaction path.
import { AsyncLocalStorage } from 'node:async_hooks';
import { SessionError } from './admin-session-service.js';

export const adminWriteInventory = Object.freeze([
  ['POST','/api/v1/admin/rfid/readers'], ['PATCH','/api/v1/admin/rfid/readers/:id'],
  ['POST','/api/v1/admin/rfid/children/:id/enrollment'], ['POST','/api/v1/admin/rfid/children/:id/revoke'],
  ['POST','/api/v1/admin/rfid/enrollments/:id/cancel'],
  ['PUT','/api/v1/safe-zones'],
  ['POST','/api/v1/admin/users'], ['POST','/api/v1/admin/users/:id/guardians'],
  ['POST','/api/v1/admin/children'], ['DELETE','/api/v1/admin/users/:id/guardians'],
  ['POST','/api/v1/admin/devices'], ['PATCH','/api/v1/admin/devices/:id/status'],
  ['POST','/api/v1/admin/devices/:id/assignment'], ['POST','/api/v1/admin/devices/:id/unassign'],
  ['POST','/api/v1/beacons'], ['PATCH','/api/v1/beacons/:id'],
  ['PATCH','/api/v1/activity/settings'], ['POST','/api/v1/attendance/:id/confirm'],
  ['POST','/api/v1/attendance/:id/reset'], ['POST','/api/v1/admin/center-invitations'],
  ['POST','/api/v1/admin/registrations/:id/decision'], ['POST','/api/v1/admin/enrollments/:id/decision'],
  ['POST','/api/v1/admin/devices/:id/claim-code'], ['POST','/api/v1/admin/wearable-requests/:id/decision'],
  ['PATCH','/api/v1/account/profile'], ['POST','/api/v1/account/password'],
  ['PATCH','/api/v1/admin/users/:id/status'], ['PATCH','/api/v1/admin/users/:id/role'],
  ['PATCH','/api/v1/admin/users/:id/profile'],
  ['PATCH','/api/v1/admin/children/:id'], ['POST','/api/v1/admin/devices/:id/transfer'],
  ['PUT','/api/v1/account/photo'],
].map(([method,path])=>Object.freeze({method,path})));
const writes = new Set(['create','createMany','createManyAndReturn','update','updateMany','updateManyAndReturn','upsert','delete','deleteMany']);
const allowed = req => adminWriteInventory.some(r=>r.method===req.method && new RegExp('^'+r.path.replaceAll(':id','[^/]+')+'/?$').test(req.path));
const refuse = () => new SessionError('SESSION_BOUND_TRANSACTION_REQUIRED',503);

export function adminSessionWriteBoundary(base) {
  const context = new AsyncLocalStorage();
  const database = new Proxy(base, {
    get(target, name) {
      const active=context.getStore(), source=active?.tx || target;
      if (active && name==='$transaction') return async (work,options={}) => {
        if (active.tx || typeof work!=='function' || !allowed(active.req) ||
            (options.isolationLevel && options.isolationLevel!=='Serializable')) throw refuse();
        const invoke=active.req.path==='/api/v1/account/password'?active.req.withAdminPasswordChange:active.req.withAdminMutation;
        if (typeof invoke!=='function') throw refuse();
        return invoke((tx,actor)=>{
          active.req.user=actor;
          return context.run({...active,tx},()=>work(tx));
        },'Serializable');
      };
      if (active && (String(name).includes('Unsafe') || name==='$executeRaw')) throw refuse();
      const value=source[name];
      if (active && !active.tx && name==='$queryRaw') return (strings,...values)=>{
        if (!Array.isArray(strings) || !/^\s*SELECT\b/i.test(strings.join('?')) || /;/.test(strings.join('?'))) throw refuse();
        return value.call(source,strings,...values);
      };
      if (value && typeof value==='object' && active && !active.tx) return new Proxy(value,{
        get(model,method) {
          if (writes.has(method)) return ()=>{throw refuse();};
          return typeof model[method]==='function'?model[method].bind(model):model[method];
        },
      });
      return typeof value==='function'?value.bind(source):value;
    },
  });
  return {database, run(req,next) {
    if (req.user?.role!=='ADMIN' || typeof req.withAdminMutation!=='function') throw refuse();
    return context.run({req},next);
  }};
}
