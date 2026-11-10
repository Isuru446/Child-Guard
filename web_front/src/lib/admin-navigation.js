const adminPaths = new Set([
  '/dashboard', '/students', '/teachers', '/parents', '/attendance', '/activity',
  '/alerts', '/registration-approval', '/authorized-pickup', '/transport',
  '/devices', '/geofence', '/safe-zones',
]);

// Accept only explicit in-app Admin destinations, never a stored last page.
export function adminDestination(returnTo) {
  if (typeof returnTo !== 'string' || /[\\\s]/.test(returnTo)) return '/dashboard';
  const pathname = returnTo.split(/[?#]/, 1)[0];
  return adminPaths.has(pathname) ? returnTo : '/dashboard';
}
