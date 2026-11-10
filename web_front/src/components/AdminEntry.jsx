import { useContext, useState, useSyncExternalStore } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AdminSessionGate from './AdminSessionGate';
import { CookieAdminSessionContext } from '../lib/admin-session-context';
import { adminDestination } from '../lib/admin-navigation';

export default function AdminEntry({ children, allowReturn = false }) {
  const client = useContext(CookieAdminSessionContext);
  const location = useLocation();
  const destination = adminDestination(allowReturn ? location.state?.returnTo : null);
  const entry = <AdminSessionGate signedOut={children}>
    <Navigate to={destination} replace />
  </AdminSessionGate>;
  return client ? <CookieEntry client={client} entry={entry}>{children}</CookieEntry> : entry;
}

function CookieEntry({ client, entry, children }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [publicEntry, setPublicEntry] = useState(false);
  // Once restoration finds no session, let login own its pending/error UI and
  // its single success navigation. Do not unmount the form during authentication.
  if (state.status === 'signed-out' && !publicEntry) setPublicEntry(true);
  return publicEntry || state.status === 'signed-out' ? children : entry;
}
