import { useState } from 'react';

import {
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
} from 'react-router-dom';

import { Menu, X } from 'lucide-react';

import AdminSidebar from './components/AdminSidebar';

import Welcome from './pages/Welcome';
import AdminLogin from './pages/AdminLogin';
import Dashboard from './pages/Dashboard';
import ActivityMonitoring from './pages/ActivityMonitoring';
import Children from './pages/Children';
import Teacher from './pages/Teacher';
import Parents from './pages/Parents';
import AttendanceOverview from './pages/AttendanceOverview';
import Alerts from './pages/Alerts';
import RegistrationApproval from './pages/RegistrationApproval';
import Pickup from './pages/Pickup';
import Transport from './pages/Transport';
import Devices from './pages/Devices';
import Geofence from './pages/Geofence';
import Beacons from './pages/Beacons';

import './App.css';
import './style/OriginalDesign.css';
import './style/AdminUX.css';
import AdminEntry from './components/AdminEntry';
import AdminSessionGate from './components/AdminSessionGate';
import SafetyNotifications from './components/SafetyNotifications';

function AdminLayout() {
  const [sidebar, setSidebar] = useState({ path: '', open: false });

  const location = useLocation();

  const isSidebarOpen = sidebar.path === location.pathname && sidebar.open;
  const closeSidebar = () => setSidebar({ path: location.pathname, open: false });


  return (
    <AdminSessionGate><SafetyNotifications><div className="app-layout"><a className="cg-skip-link" href="#cg-main">Skip to main content</a>
      <button
        type="button"
        className="mobile-menu-button"
        onClick={() =>
          setSidebar({ path: location.pathname, open: !isSidebarOpen })
        }
        aria-label={
          isSidebarOpen
            ? 'Close navigation menu'
            : 'Open navigation menu'
        }
        aria-expanded={isSidebarOpen}
      >
        {isSidebarOpen ? (
          <X size={22} />
        ) : (
          <Menu size={22} />
        )}
      </button>

      {isSidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={closeSidebar}
        />
      )}

      <AdminSidebar
        isOpen={isSidebarOpen}
        onClose={closeSidebar}
      />

      <main id="cg-main" tabIndex={-1} className="app-main-content" data-admin-page={location.pathname === '/dashboard' ? 'dashboard' : 'management'}>
        <Outlet />
      </main>
    </div></SafetyNotifications></AdminSessionGate>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AdminEntry><Welcome /></AdminEntry>} />

      <Route path="/login" element={<AdminEntry allowReturn><AdminLogin /></AdminEntry>} />

      <Route element={<AdminLayout />}>
        <Route path="/parents" element={<Parents />} />
        <Route path="/activity" element={<ActivityMonitoring />} />
        <Route
          path="/dashboard"
          element={<Dashboard />}
        />

        <Route
          path="/students"
          element={<Children />}
        />

        <Route
          path="/teachers"
          element={<Teacher />}
        />

        <Route
          path="/attendance"
          element={<AttendanceOverview />}
        />

        <Route
          path="/alerts"
          element={<Alerts />}
        />

        <Route
          path="/registration-approval"
          element={<RegistrationApproval />}
        />

        <Route
          path="/authorized-pickup"
          element={<Pickup />}
        />

        <Route
          path="/transport"
          element={<Transport />}
        />

        <Route
          path="/devices"
          element={<Devices />}
        />

        <Route
          path="/geofence"
          element={<Geofence />}
        />

        <Route
          path="/safe-zones"
          element={<Beacons />}
        />
      </Route>

      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}
