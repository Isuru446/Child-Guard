import ModalCloseButton from './ModalCloseButton';
import useDialogAccessibility from '../hooks/useDialogAccessibility';
import { useContext, useRef, useState } from 'react';
import { CookieAdminSessionContext } from '../lib/admin-session-context';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bell, LogOut, AlertTriangle } from 'lucide-react';
import './Topbar.css';
import usePollingApi from '../hooks/usePollingApi';
import { clearSession } from '../lib/api';
import {SafetyNoticeContext} from '../lib/safety-notice-context';



export default function Topbar({hideTitle=false}) {
  const navigate = useNavigate();
  const session=useContext(CookieAdminSessionContext);
  const safety=useContext(SafetyNoticeContext);
  const location = useLocation();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const dialogRef=useRef(null);
  useDialogAccessibility(dialogRef,()=>setShowLogoutModal(false),{open:showLogoutModal});


  const pending = usePollingApi('/api/v1/attendance/pending-count','childguard:attendance-updated');

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });



  // Select title according to the current URL
  const getPageTitle = () => {
    switch (location.pathname) {
      case '/dashboard':
        return 'Dashboard';

      case '/attendance':
        return 'Attendance Overview';  

      case '/students':
        return 'Children';

      case '/teachers':
        return 'Teachers';

      case '/parents':
        return 'Parents';
      case '/activity':
        return 'Activity Monitoring';
      case '/alerts':
        return 'Alerts & Notifications';

      case '/registration-approval':
        return 'Requests & Approvals';

      case '/authorized-pickup':
        return 'Authorized Pickup';

      case '/transport':
        return 'Transport Management';

      case '/devices':
        return 'Wearable Devices';

      case '/geofence':
        return 'GPS Safe Area';

      case '/safe-zones':
        return 'Safe Zones & Beacons';

      default:
        return 'Dashboard';
    }
  };

  const handleNotificationClick = () => {
    navigate(safety.count ? '/alerts' : pending.data?.count ? '/attendance#pending-attendance' : '/alerts');
  };

  const handleLogoutConfirm = async () => {
    setShowLogoutModal(false);
    let sessionMessage;
    if(session) {
      try { await session.logout(); }
      catch { sessionMessage='Signed out on this device. Server sign-out is not yet confirmed.'; }
    } else clearSession();
    navigate('/login', { replace: true, state:{sessionMessage} });

   
  };

  return (
    <>
      <header className="topbar">
        {/* Page title and date */}
            <div className="topbar__page-info">
              {!hideTitle&&<h1 className="topbar__title">{getPageTitle()}</h1>}
              <p className="topbar__date">{currentDate}</p>
            </div>


        {/* Right-side actions */}
        <div className="topbar__actions">
              {/* Notification button */}
              <button
                type="button"
                className="topbar__notification"
                onClick={handleNotificationClick}
                title={safety.unavailable ? 'Safety notifications unavailable' : safety.count ? `${safety.count} new danger alert notifications in this session` : pending.error ? 'Notifications unavailable' : `${pending.data?.count || 0} pending attendance approvals`}
                aria-label={safety.count ? `${safety.count} new danger alert notifications` : pending.data?.count ? `${pending.data.count} pending attendance approvals` : 'Go to alerts'}
              >
                <Bell size={20} />

                {(safety.count > 0 || pending.data?.count > 0) && (
                  <span className="topbar__notification-count">{safety.count || pending.data.count}</span>
                )}
              </button>


              {/* Admin profile */}
              <div className="topbar__profile">
                <div className="topbar__avatar">TA</div>
                <span className="topbar__admin-name">{session ? session.getSnapshot().user?.username || 'Admin' : sessionStorage.getItem('childguardAdminName') || 'Admin'}</span>
              </div>

              
        </div>
      </header>

      {/* Logout confirmation modal */}
      {showLogoutModal && (
        <div
          className="logout-modal__overlay"
          onClick={event=>{if(event.target===event.currentTarget){event.stopPropagation();setShowLogoutModal(false);}}}
        >
          <div
            className="logout-modal"
            ref={dialogRef}
            role="dialog" data-dialog-size="small"
            aria-modal="true"
            aria-labelledby="logout-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Modal header */}
            <div className="logout-modal__header">
              <div className="logout-modal__heading">
                <div className="logout-modal__warning-icon">
                  <AlertTriangle size={20} />
                </div>

                <h3
                  id="logout-modal-title"
                  className="logout-modal__title"
                >
                  Confirm Logout
                </h3>
              </div>

              <ModalCloseButton onClick={() => setShowLogoutModal(false)} />
            </div>

            {/* Modal body */}
            <div className="logout-modal__body">
              Are you sure you want to logout?
            </div>

            {/* Modal footer */}
            <div className="logout-modal__footer">
              <button
                type="button"
                className="logout-modal__cancel"
                onClick={() => setShowLogoutModal(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="logout-modal__confirm"
                onClick={handleLogoutConfirm}
              >
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
