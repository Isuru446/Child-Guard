let cookieClient=null;
export function configureAdminCookieClient(client) {
 if (!client || (cookieClient && cookieClient!==client)) throw new Error('Cookie session configuration refused');
 cookieClient=client;
}
const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export function setToken(token) { if(cookieClient)throw new Error('Bearer storage disabled'); sessionStorage.setItem('childguardToken', token); }
export function hasToken() { if(cookieClient)return cookieClient.getSnapshot().status==='ready'; return Boolean(sessionStorage.getItem('childguardToken')); }
export function clearSession(message = '') {
 if(cookieClient)throw new Error('Use asynchronous server logout');
 sessionStorage.removeItem('childguardToken');
 sessionStorage.removeItem('childguardAdminName');
 window.dispatchEvent(new CustomEvent('childguard:session-ended', {detail:{message}}));
}
export class ApiError extends Error {
 constructor(message, status = 0, code = 'NETWORK_ERROR') {
  super(message); this.name = 'ApiError'; this.status = status; this.code = code;
 }
}
export async function api(path, options = {}) {
 if(cookieClient)return cookieClient.request(path,options);
 const token = sessionStorage.getItem('childguardToken');
 let response;
 try {
  response = await fetch(`${base}${path}`, {
   ...options,
   headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
 } catch { throw new ApiError('Cannot reach ChildGuard API. Check your connection and try again.'); }
 const signingIn = path === '/api/v1/auth/login';
 const sessionMessage = 'Your session has expired. Please sign in again.';
 if (response.status === 401 && sessionStorage.getItem('childguardToken') === token) clearSession(signingIn ? '' : sessionMessage);
 let body;
 try { body = await response.json(); } catch { /* HTTP status still identifies authentication and rate-limit failures. */ }
 if (response.status === 401) throw new ApiError(signingIn ? 'Invalid username or password.' : sessionMessage, 401, signingIn ? 'INVALID_CREDENTIALS' : 'UNAUTHENTICATED');
 if (response.status === 429) throw new ApiError('Too many attempts. Please wait a minute before trying again.', 429, 'RATE_LIMITED');
 if (!response.ok) {
  throw new ApiError(response.status >= 500 ? 'ChildGuard is temporarily unavailable. Please try again.' : body?.error?.message || 'API request failed. Please try again.', response.status, body?.error?.code || 'REQUEST_FAILED');
 }
 if (!body || typeof body !== 'object' || !Object.hasOwn(body,'data')) throw new Error('Unexpected response from ChildGuard API.');
 return body.data;
}

export async function privatePhoto(id) {
 if(cookieClient)return cookieClient.privatePhoto(id);
 const token=sessionStorage.getItem('childguardToken');
 const response=await fetch(`${base}/api/v1/account/photos/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`}});
 if(!response.ok)throw new Error('Photo unavailable');
 return URL.createObjectURL(await response.blob());
}
