// WP02-D Admin cookie transport; credentials and CSRF stay out of browser storage.
// No token/sessionStorage/localStorage reads, background activity or timers.
export function createAdminSessionAdapter({fetchImpl = globalThis.fetch, now = Date.now, newId = () => crypto.randomUUID(), onEnded = () => {}, onSession = () => {}} = {}) {
  let state = null, generation = 0, pendingActivity = false, lastSent = -Infinity;
  const error = (message, status = 0, code = 'NETWORK_ERROR') => Object.assign(new Error(message), {status, code});
  function ended(message = '') { state = null; pendingActivity = false; lastSent = -Infinity; generation++; onEnded(message); }
  async function send(path, options, csrfToken, ownGeneration, binary = false) {
    if (!/^\/api\/v1\/[A-Za-z0-9_/?=&.%+-]+$/.test(path) || path.includes('..') || path.includes('://')) throw error('Invalid API path');
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    if (headers.has('Authorization') || headers.has('Cookie')) throw error('Alternate credentials refused');
    const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (multipart) headers.delete('Content-Type'); // Browser supplies its boundary.
    else if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!['GET','HEAD'].includes(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    let response;
    try { response = await fetchImpl(path, {...options, method, headers, credentials:'same-origin', redirect:'error', cache:'no-store'}); }
    catch { throw error('Cannot reach ChildGuard API. Check your connection and try again.'); }
    if (ownGeneration !== generation) throw error('Stale session response discarded', 0, 'STALE_RESPONSE');
    if(response.ok && binary) {
      const blob=await response.blob();
      if(ownGeneration!==generation)throw error('Stale session response discarded',0,'STALE_RESPONSE');
      return blob;
    }
    let body; try { body = await response.json(); } catch { /* Status is still authoritative. */ }
    if (ownGeneration !== generation) throw error('Stale session response discarded', 0, 'STALE_RESPONSE');
    if (response.status === 401) {
      const message=path.endsWith('/login') ? 'Invalid username or password.' : 'Your session has expired. Please sign in again.';
      ended(message);
      throw error(message, 401, body?.error?.code || 'UNAUTHENTICATED');
    }
    if (response.status === 429) throw error('Too many attempts. Please wait a minute before trying again.', 429, 'RATE_LIMITED');
    if (!response.ok) throw error(response.status >= 500 ? 'ChildGuard is temporarily unavailable. Please try again.' : 'Request not permitted. Please retry or sign in again.', response.status, body?.error?.code || 'REQUEST_FAILED');
    if (!body || !Object.hasOwn(body,'data')) throw error('Unexpected session response', 0, 'INVALID_RESPONSE');
    if (body.data?.token || body.data?.accessToken || body.data?.refreshCredential) {
      if(path==='/api/v1/auth/login' && ['PARENT','TEACHER'].includes(body.data.user?.role)) {
        const message='An administrator account is required for this dashboard.';
        ended(message);throw error(message,403,'ADMIN_REQUIRED');
      }
      throw error('Unexpected session response',0,'INVALID_RESPONSE');
    }
    return body.data;
  }
  function remember(data) {
    if (data?.user?.role !== 'ADMIN' || typeof data.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.csrfToken) ||
        !Number.isFinite(Date.parse(data.session?.idleExpiresAt)) || !Number.isFinite(Date.parse(data.serverTime))) {
      ended(); throw error('An administrator session is required', 401, 'UNAUTHENTICATED');
    }
    state = {user:{...data.user}, session:{...data.session}, csrfToken:data.csrfToken, serverTime:Date.parse(data.serverTime), receivedAt:now()};
    onSession({user:{...state.user},session:{...state.session}});
    return {user:{...state.user}, session:{...state.session}};
  }
  const remaining = () => state ? Date.parse(state.session.idleExpiresAt) - (state.serverTime + now() - state.receivedAt) : 0;
  return {
    async login(username, password) {
      state = null; pendingActivity = false; const ownGeneration = ++generation; lastSent = -Infinity;
      return remember(await send('/api/v1/auth/login', {method:'POST', body:JSON.stringify({username,password})}, null, ownGeneration));
    },
    async restore() { const ownGeneration = generation; return remember(await send('/api/v1/auth/me', {}, null, ownGeneration)); },
    request(path, options = {}) { return send(path, options, state?.csrfToken, generation); },
    async privatePhoto(id) {
      if(!/^[a-f0-9-]{36}$/.test(id))throw error('Invalid photo identifier');
      return URL.createObjectURL(await send('/api/v1/account/photos/'+id,{},null,generation,true));
    },
    remainingMs:remaining,
    async logout() {
      const token = state?.csrfToken;
      state = null; pendingActivity = false; lastSent = -Infinity; const ownGeneration = ++generation; onEnded();
      // Failure means local sign-out only; callers must report revocation pending.
      return send('/api/v1/auth/logout', {method:'POST', body:'{}'}, token, ownGeneration);
    },
    async recordInteraction(event) {
      if (!event?.isTrusted || !['pointerdown','keydown','touchstart','input'].includes(event.type) || !state || pendingActivity || remaining() <= 0) return false;
      const at = now();
      if (at - lastSent < 15000 && remaining() > 15000) return false;
      lastSent = at; pendingActivity = true;
      const ownGeneration = generation;
      try {
        const data = await send('/api/v1/auth/activity', {method:'POST',body:JSON.stringify({interactionId:newId()})}, state.csrfToken, ownGeneration);
        if (!Number.isFinite(Date.parse(data.idleExpiresAt)) || !Number.isFinite(Date.parse(data.serverTime))) throw error('Unexpected session response');
        state.session.idleExpiresAt = data.idleExpiresAt;
        state.serverTime = Date.parse(data.serverTime); state.receivedAt = now();
        onSession({user:{...state.user},session:{...state.session}});
        return true;
      } finally { if (ownGeneration === generation) pendingActivity = false; }
    },
    bindTrustedActivity(target = window, onError = () => {}) {
      const listener = event => { this.recordInteraction(event).catch(onError); };
      const types = ['pointerdown','keydown','touchstart','input'];
      types.forEach(type=>target.addEventListener(type,listener,{passive:true}));
      return () => types.forEach(type=>target.removeEventListener(type,listener));
    },
  };
}
