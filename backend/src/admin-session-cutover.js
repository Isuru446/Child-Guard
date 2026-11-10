// Server-owned session composition. Session policy never comes from clientKind.
import jwt from 'jsonwebtoken';
import { SessionError } from './admin-session-service.js';
import { createAdminSessionRouter } from './admin-session-http.js';
import { adminSessionWriteBoundary } from './admin-session-write-boundary.js';

export function legacyMobileBridge({db,jwtSecret}) {
  if (typeof jwtSecret!=='string' || jwtSecret.length<32) throw new SessionError('SERVICE_UNAVAILABLE',503);
  const view=u=>({id:u.id,username:u.username,role:u.role,centerId:u.centerId});
  const mobile=u=>u?.active && ['PARENT','TEACHER'].includes(u.role);
  return {
    async login(verified) {
      const user=await db.user.findUnique({where:{id:verified.id}});
      if (!mobile(user) || user.passwordHash!==verified.passwordHash) throw new SessionError('INVALID_CREDENTIALS');
      return {token:jwt.sign({},jwtSecret,{subject:user.id,expiresIn:'1h',issuer:'childguard',audience:'childguard-app',algorithm:'HS256'}),user:view(user),expiresIn:3600};
    },
    async authenticate(header) {
      let claims;
      try {
        if (!/^Bearer \S+$/.test(header || '')) throw Error();
        claims=jwt.verify(header.slice(7),jwtSecret,{algorithms:['HS256'],issuer:'childguard',audience:'childguard-app'});
        if(typeof claims!=='object'||typeof claims.sub!=='string'||!claims.sub)throw Error();
      } catch { throw new SessionError('UNAUTHENTICATED'); }
      const user=await db.user.findUnique({where:{id:claims.sub}});
      if (!mobile(user)) throw new SessionError('UNAUTHENTICATED');
      return view(user);
    },
    async streamSession(header){
      const user=await this.authenticate(header),claims=jwt.decode(header.slice(7));
      return {user,expiresAt:typeof claims?.exp==='number'?claims.exp*1000:null};
    },
  };
}
export function prepareAdminSessionCutover({db,service,transport,jwtSecret,absoluteAdminPolicy,devAttendanceResetEnabled=false}) {
  // WP02-D owner-approved; callers must still select this policy explicitly.
  if (absoluteAdminPolicy!=='OWNER_ACCEPTED_ADMIN_8H_CEILING') throw new SessionError('ADMIN_POLICY_DECISION_REQUIRED',503);
  const scope=adminSessionWriteBoundary(db);
  return {database:scope.database, router:createAdminSessionRouter({db,service,transport,
    mobileBridge:legacyMobileBridge({db,jwtSecret}),requestScope:scope,devAttendanceResetEnabled})};
}
