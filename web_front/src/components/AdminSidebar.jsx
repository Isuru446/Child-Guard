import { useContext } from 'react';
import { CookieAdminSessionContext } from '../lib/admin-session-context';
import {
  NavLink,
  useNavigate,
} from 'react-router-dom';

import {
  LayoutDashboard,
  Users,
  Bell,
  UserCheck,
  Bus,
  Cpu,
  ShieldAlert,
  MapPin,
  GraduationCap,
  CalendarDays,
  LogOut,
} from 'lucide-react';

import logo from '../assets/logo.png';

import './AdminSidebar.css';
import { clearSession } from '../lib/api';

const menuItems = [
  {
    path: '/dashboard',
    name: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    path: '/students',
    name: 'Children',
    icon: Users,
  },
  {
    path: '/teachers',
    name: 'Teachers',
    icon: GraduationCap,
  },
  {path:'/parents',name:'Parents',icon:Users},
  {
    path: '/attendance',
    name: 'Attendance Overview',
    icon: CalendarDays,
  },
  {path:'/activity',name:'Activity Monitoring',icon:Users},
  {
    path: '/alerts',
    name: 'Alerts & Notifications',
    icon: Bell,
  },
  {
    path: '/registration-approval',
    name: 'Requests & Approvals',
    icon: UserCheck,
  },
  {
    path: '/authorized-pickup',
    name: 'Authorized Pickup',
    icon: Users,
  },
  {
    path: '/transport',
    name: 'Transport Information',
    icon: Bus,
  },
  {
    path: '/devices',
    name: 'Wearable Devices',
    icon: Cpu,
  },
  {
    path: '/geofence',
    name: 'GPS Safe Area',
    icon: ShieldAlert,
  },
  {
    path: '/safe-zones',
    name: 'Safe Zones & Beacons',
    icon: MapPin,
  },
];

export default function AdminSidebar({
  isOpen,
  onClose,
}) {
  const navigate = useNavigate();
  const session=useContext(CookieAdminSessionContext);

  const handleLogout = async () => {
    let sessionMessage;
    if(session) {
      try { await session.logout(); }
      catch { sessionMessage='Signed out on this device. Server sign-out is not yet confirmed.'; }
    } else clearSession();
    onClose?.();
    navigate('/login', { replace: true, state:{sessionMessage} });
  };

  return (
    <aside
      className={`admin-sidebar ${
        isOpen ? 'admin-sidebar--open' : ''
      }`}
      aria-label="Admin sidebar"
    >
      <div className="admin-sidebar__top">
        {/* Logo and brand */}
        <div className="admin-sidebar__header">
          <img
            src={logo}
            alt="ChildGuard logo"
            className="admin-sidebar__logo"
          />

          <div className="admin-sidebar__brand">
            <h2 className="admin-sidebar__title">
              Child<span>Guard</span>
            </h2>

            <p className="admin-sidebar__tagline">
              Safe today, bright tomorrow
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav
          className="admin-sidebar__nav"
          aria-label="Admin navigation"
        >
          {menuItems.map(
            ({ path, name, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                onClick={() => onClose?.()}
                className={({ isActive }) =>
                  `admin-sidebar__link ${
                    isActive
                      ? 'admin-sidebar__link--active'
                      : ''
                  }`
                }
              >
                <span className="admin-sidebar__icon">
                  <Icon
                    size={20}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                </span>

                <span>{name}</span>
              </NavLink>
            )
          )}
        </nav>
      </div>

      {/* Logout */}
      <button
        type="button"
        className="admin-sidebar__logout"
        onClick={handleLogout}
      >
        <LogOut
          size={20}
          aria-hidden="true"
        />

        <span>Logout</span>
      </button>
    </aside>
  );
}
