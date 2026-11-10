// Admin cookie admission and the explicit Parent/Teacher compatibility bridge.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { SessionError } from './admin-session-service.js';
import { registrationLoginStatus,findLoginUser } from './registration-login.js';

export function adminCookieTransport({mode, environment, origin}) {
  if (mode === 'local-development' && environment === 'development' && origin === 'http://localhost:5174') {
    return Object.freeze({origin, secure:false, name:'childguard_admin_dev', host:'localhost:5174'});
  }
  if (mode === 'https' && ['development','production'].includes(environment)) {
    const url = new URL(origin);
    if (url.protocol === 'https:' && url.origin === origin && !url.username && !url.password) {
      return Object.freeze({origin, secure:true, name:'__Host-childguard_admin', host:url.host});
    }
  }
  throw new SessionError('SERVICE_UNAVAILABLE', 503);
}
const cookieOptions = transport => ({httpOnly:true, secure:transport.secure, sameSite:'strict', path:'/'});
function sameOrigin(req, transport, mutation = false) {
  if (req.get('Host') !== transport.host || req.secure !== transport.secure ||
      (req.get('Origin') && req.get('Origin') !== transport.origin) ||
      (req.get('Sec-Fetch-Site') && !['same-origin','none'].includes(req.get('Sec-Fetch-Site')))) throw new SessionError('CSRF_INVALID', 403);
  if (mutation && req.get('Origin') !== transport.origin) throw new SessionError('CSRF_INVALID', 403);
}
function credential(req, transport) {
  // Duplicate cookie names, encodings and alternate transports are refused.
  if (req.get('Authorization')) throw new SessionError('UNAUTHENTICATED');
  const matches = (req.get('Cookie') || '').split(';').map(s=>s.trim()).filter(s=>s.split('=')[0]===transport.name);
  if (matches.length > 1) throw new SessionError('UNAUTHENTICATED');
  return matches[0]?.slice(transport.name.length + 1);
}
const wrap = fn => (req,res,next) => Promise.resolve().then(()=>fn(req,res,next)).catch(next);
const loginSchema = z.object({username:z.string().trim().min(1).max(254),password:z.string().min(1).max(200)}).strict();
const activitySchema = z.object({interactionId:z.string().uuid()}).strict();

export function createAdminSessionRouter({db, service, transport, mobileBridge = null, requestScope = null, devAttendanceResetEnabled = false}) {
  // Accept only a server-constructed, validated transport configuration.
  const expected = adminCookieTransport({mode:transport?.secure?'https':'local-development', environment:transport?.secure?'production':'development', origin:transport?.origin});
  if (JSON.stringify(transport) !== JSON.stringify(expected)) throw new SessionError('SERVICE_UNAVAILABLE',503);
  const router = Router();
  const dummyHash = bcrypt.hashSync('invalid-credential-placeholder',12);
  router.use('/api/v1', (req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.post('/api/v1/auth/login', rateLimit({windowMs:60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Try again later'}}}), wrap(async(req,res)=>{
    if (!req.is('application/json')) throw new SessionError('VALIDATION_ERROR',422);
    const body = loginSchema.parse(req.body);
    const user = await findLoginUser(db,body.username);
    if(!user){const application=await registrationLoginStatus(db,body.username,body.password,dummyHash);if(application)return res.status(403).json({error:application});throw new SessionError('INVALID_CREDENTIALS');}
    const valid = await bcrypt.compare(body.password, user.passwordHash || dummyHash);
    if (!valid || !user?.active) throw new SessionError('INVALID_CREDENTIALS');
    if (user.role!=='ADMIN') {
      if (!mobileBridge || !['PARENT','TEACHER'].includes(user.role)) throw new SessionError('INVALID_CREDENTIALS');
      return res.json({data:await mobileBridge.login(user)});
    }
    sameOrigin(req, transport, true);
    const {credential:secret, ...data} = await service.create({userId:user.id, verifiedPasswordHash:user.passwordHash});
    res.cookie(transport.name, secret, cookieOptions(transport));
    res.json({data});
  }));
  router.post('/api/v1/auth/logout', wrap(async(req,res)=>{
    // Clear even on expired/revoked/rejected logout; errors never claim revocation.
    res.clearCookie(transport.name, cookieOptions(transport));
    sameOrigin(req, transport, true);
    z.object({}).strict().parse(req.body);
    res.json({data:await service.revoke(credential(req,transport),req.get('X-CSRF-Token'))});
  }));
  router.post('/api/v1/auth/activity', wrap(async(req,res)=>{
    sameOrigin(req, transport, true);
    const {interactionId} = activitySchema.parse(req.body);
    res.json({data:await service.activity(credential(req,transport),req.get('X-CSRF-Token'),interactionId)});
  }));
  // Selected in place of legacy JWT admission by the server composition.
  // All private GETs, images, reports and writes must traverse this middleware.
  router.use('/api/v1', wrap(async(req,res,next)=>{
    if (mobileBridge && req.get('Authorization')) {
      if ((req.get('Cookie')||'').split(';').some(c=>c.trim().startsWith(transport.name+'='))) throw new SessionError('UNAUTHENTICATED');
      req.user=await mobileBridge.authenticate(req.get('Authorization'));
      req.authTransport='legacy-mobile';
      req.validateMobileStream=()=>mobileBridge.streamSession(req.get('Authorization'));
      return next();
    }
    sameOrigin(req, transport, !['GET','HEAD','OPTIONS'].includes(req.method));
    const secret = credential(req,transport);
    const data = await service.validate(secret);
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      // The request-scoped DB facade additionally authorizes each writer's transaction.
      await service.access(secret, tx => service.checkCsrf(tx.session, secret, req.get('X-CSRF-Token')));
    }
    req.user = data.user;
    req.adminSession = data.session;
    req.authTransport='admin-cookie';
    // Read-only validation for every stream message/heartbeat; never calls activity().
    req.validateMonitoringSession = () => service.validate(secret);
    req.withAdminMutation = (action,isolation) => service.withMutation(secret, req.get('X-CSRF-Token'), action,isolation);
    req.withAdminPasswordChange = (action,isolation) => service.withPasswordChange(secret,req.get('X-CSRF-Token'),action,isolation);
    if (requestScope) return requestScope.run(req,next);
    next();
  }));
  router.get('/api/v1/auth/me', wrap(async(req,res)=>{
    // CSRF recovery after page refresh is read-only and same-origin. The token
    // derives from the HttpOnly credential plus a server-held key, not DB plaintext.
    if(req.authTransport==='legacy-mobile')return res.json({data:{...req.user,devAttendanceResetEnabled:false}});
    const data=await service.validate(credential(req,transport));
    // Existing polling pages consume flat identity fields; keep those additive.
    res.json({data:{...data.user,...data,devAttendanceResetEnabled:devAttendanceResetEnabled===true}});
  }));
  router.use((error,req,res,next)=>{ // eslint-disable-line no-unused-vars
    const status = error instanceof ZodError ? 422 : error instanceof SessionError ? error.status : 503;
    const code = error instanceof ZodError ? 'VALIDATION_ERROR' : error instanceof SessionError ? error.code : 'SERVICE_UNAVAILABLE';
    if (status === 401) res.clearCookie(transport.name, cookieOptions(transport));
    res.status(status).json({error:{code,message:status===503?'Session service temporarily unavailable':status===403?'Request not permitted':status===422?'Invalid request payload':'Sign in required'}});
  });
  return router;
}
