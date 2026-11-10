import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export class SessionError extends Error {
  constructor(code, status = 401) { super(status === 503 ? 'Session service temporarily unavailable' : status === 403 ? 'Request not permitted' : 'Sign in required'); this.code = code; this.status = status; }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const idleMs = 300000, absoluteMs = 28800000;
class SessionActionError extends Error {
  constructor(error) { super(error.message); this.status=error.status; this.code=error.code; }
}

// Repository owns locking and DB time. No process/env, HTTP or Prisma imports.
export class SessionService {
  #csrfKey;
  constructor({ repository, csrfKey }) {
    if (!repository || !Buffer.isBuffer(csrfKey) || csrfKey.length < 32) throw new SessionError('SERVICE_UNAVAILABLE', 503);
    this.repository = repository; this.#csrfKey = Buffer.from(csrfKey);
  }
  csrf(credential) { return createHmac('sha256', this.#csrfKey).update('childguard-admin-csrf-v1\0').update(credential).digest('base64url'); }
  async safe(work) {
    try { return await work(); } catch (e) {
      if (e instanceof SessionError || e instanceof SessionActionError) throw e;
      // Preserve existing serial()/unique-conflict behavior, without engine text.
      if (['P2002','P2034'].includes(e?.code) || (e?.code==='P2010'&&['40001','40P01'].includes(e.meta?.code))) {
        throw new SessionActionError({message:'Database transaction could not complete',code:e.code==='P2002'?'P2002':'P2034'});
      }
      throw new SessionError('SERVICE_UNAVAILABLE', 503);
    }
  }
  async action(work) {
    try { return await work(); } catch(e) {
      if ([400,403,404,409,422,429].includes(e?.status) && /^[A-Z][A-Z_]{1,63}$/.test(e?.code)) throw new SessionActionError(e);
      throw e;
    }
  }
  check(session, user, now) {
    if (!session) throw new SessionError('UNAUTHENTICATED');
    if (session.revokedAt || !user?.active || user.role !== 'ADMIN' || session.clientKind !== 'ADMIN_WEB' || session.roleAtLogin !== 'ADMIN' ||
        user.id !== session.userId || user.centerId !== session.centerId || user.authVersion !== session.authVersion) throw new SessionError('SESSION_REVOKED');
    if (!(now instanceof Date) || !Number.isFinite(+now) || !Number.isSafeInteger(user.authVersion) || user.authVersion < 0 ||
        ![session.createdAt, session.lastActivityAt, session.idleExpiresAt, session.absoluteExpiresAt].every(d => d instanceof Date && Number.isFinite(+d)) ||
        +session.createdAt > +session.lastActivityAt || +session.lastActivityAt > +now || +session.idleExpiresAt <= +session.lastActivityAt || +session.idleExpiresAt > +session.absoluteExpiresAt ||
        +session.idleExpiresAt > +session.lastActivityAt + idleMs || +session.absoluteExpiresAt > +session.createdAt + absoluteMs) throw new SessionError('UNAUTHENTICATED');
    if (+now >= +session.idleExpiresAt || +now >= +session.absoluteExpiresAt) throw new SessionError('SESSION_EXPIRED');
  }
  checkCsrf(session, credential, token) {
    if (!opaque(token) || !sameHash(digest(token), session.csrfHash) || !sameHash(digest(this.csrf(credential)), session.csrfHash)) throw new SessionError('CSRF_INVALID', 403);
  }
  view(session, user, now, credential) {
    return { user: {id:user.id, username:user.username, role:user.role, centerId:user.centerId},
      session: {id:session.id, createdAt:session.createdAt, absoluteExpiresAt:session.absoluteExpiresAt, idleExpiresAt:session.idleExpiresAt},
      serverTime:now, csrfToken:this.csrf(credential) };
  }
  async create({ userId, verifiedPasswordHash }) {
    return this.safe(() => this.repository.forUser(userId, async tx => {
      const user = tx.user;
      if (!user?.active || user.id !== userId || user.role !== 'ADMIN' || typeof verifiedPasswordHash !== 'string' || user.passwordHash !== verifiedPasswordHash || !Number.isSafeInteger(user.authVersion) || user.authVersion < 0 || !user.centerId) throw new SessionError('INVALID_CREDENTIALS');
      const now = await tx.now();
      const credential = randomBytes(32).toString('base64url');
      const session = {id:randomUUID(), userId:user.id, centerId:user.centerId, clientKind:'ADMIN_WEB', roleAtLogin:'ADMIN', authVersion:user.authVersion,
        credentialHash:digest(credential), csrfHash:digest(this.csrf(credential)), createdAt:now, lastActivityAt:now,
        idleExpiresAt:new Date(+now + idleMs), absoluteExpiresAt:new Date(+now + absoluteMs), revokedAt:null, revokeReason:null, revision:0, lastInteractionId:null};
      this.check(session, user, now);
      await tx.insert(session);
      await tx.audit('ADMIN_SESSION_CREATED', session.id);
      return {credential, ...this.view(session, user, now, credential)};
    }));
  }
  async access(credential, work, isolationLevel) {
    if (!opaque(credential)) throw new SessionError('UNAUTHENTICATED');
    return this.safe(() => this.repository.forCredential(digest(credential), async tx => {
      const now = await tx.now(); this.check(tx.session, tx.user, now);
      if (!sameHash(tx.session.credentialHash, digest(credential)) || !sameHash(tx.session.csrfHash, digest(this.csrf(credential)))) throw new SessionError('SESSION_REVOKED');
      return work(tx, now);
    }, isolationLevel));
  }
  validate(credential) {
    return this.access(credential, (tx, now) => this.view(tx.session, tx.user, now, credential));
  }
  activity(credential, csrfToken, interactionId) {
    if (typeof interactionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(interactionId)) throw new SessionError('VALIDATION_ERROR', 422);
    interactionId = interactionId.toLowerCase();
    return this.access(credential, async (tx, now) => {
      this.checkCsrf(tx.session, credential, csrfToken);
      if (tx.session.lastInteractionId !== interactionId) {
        const idleExpiresAt = new Date(Math.min(+now + idleMs, +tx.session.absoluteExpiresAt));
        await tx.update({lastActivityAt:now, idleExpiresAt, lastInteractionId:interactionId, revision:tx.session.revision + 1});
      }
      return {serverTime:now, idleExpiresAt:tx.session.idleExpiresAt};
    });
  }
  async revoke(credential, csrfToken) {
    if (!opaque(credential)) return {revoked:true};
    return this.safe(() => this.repository.forCredential(digest(credential), async tx => {
      if (!tx.session || tx.session.revokedAt) return {revoked:true};
      const now = await tx.now();
      // Still-live sessions require synchronizer CSRF even if the user changed.
      if (+now < +tx.session.idleExpiresAt && +now < +tx.session.absoluteExpiresAt) this.checkCsrf(tx.session, credential, csrfToken);
      await tx.update({revokedAt:now, revokeReason:'LOGOUT', revision:tx.session.revision + 1});
      await tx.audit('ADMIN_SESSION_REVOKED', tx.session.id);
      return {revoked:true};
    }));
  }
  // Future private mutations must run inside this boundary, not merely behind
  // an Express precheck. Callback is DB-only; never call external providers here.
  withMutation(credential, csrfToken, action, isolationLevel) {
    return this.access(credential, async tx => {
      this.checkCsrf(tx.session, credential, csrfToken);
      const actor = this.view(tx.session, tx.user, await tx.now(), credential).user;
      const result = await this.action(()=>action(tx.db, actor));
      await tx.refresh();
      this.check(tx.session, tx.user, await tx.now()); // Expiry during work rolls back.
      return result;
    }, isolationLevel);
  }
  // Self password change intentionally revokes the caller. This narrow operation
  // admits only that precise account transition; no general revocation bypass.
  withPasswordChange(credential, csrfToken, action, isolationLevel) {
    return this.access(credential, async tx => {
      this.checkCsrf(tx.session, credential, csrfToken);
      const beforeUser = {...tx.user}, beforeSession = {...tx.session};
      const actor = this.view(tx.session, tx.user, await tx.now(), credential).user;
      const result = await this.action(()=>action(tx.db, actor));
      await tx.refresh();
      const u=tx.user, s=tx.session, now=await tx.now();
      this.check(beforeSession, beforeUser, now);
      if (!u || !s || u.id!==beforeUser.id || !u.active || u.role!==beforeUser.role || u.centerId!==beforeUser.centerId ||
          u.username!==beforeUser.username || u.authVersion!==beforeUser.authVersion+1 ||
          u.passwordHash===beforeUser.passwordHash || !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(u.passwordHash) ||
          s.id!==beforeSession.id || s.userId!==beforeSession.userId || s.credentialHash!==beforeSession.credentialHash ||
          !(s.revokedAt instanceof Date) || +s.revokedAt>+now || +s.revokedAt<+beforeSession.createdAt || s.revokeReason!=='ACCOUNT_CHANGED' ||
          s.authVersion!==beforeSession.authVersion || s.csrfHash!==beforeSession.csrfHash ||
          !['centerId','clientKind','roleAtLogin','lastInteractionId'].every(k=>s[k]===beforeSession[k]) || s.revision!==beforeSession.revision+1 ||
          +s.createdAt!==+beforeSession.createdAt || +s.lastActivityAt!==+beforeSession.lastActivityAt ||
          +s.idleExpiresAt!==+beforeSession.idleExpiresAt || +s.absoluteExpiresAt!==+beforeSession.absoluteExpiresAt) throw new SessionError('SESSION_REVOKED');
      return result;
    }, isolationLevel);
  }
}
