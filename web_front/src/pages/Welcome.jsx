import { Link } from 'react-router-dom';
import '../style/Welcome.css';
import logo from '../assets/logo.png';

export default function Welcome() {
  return (
    <main className="welcome-page">
      <section className="welcome-content">
        <div className="welcome-brand">
          <img
            src={logo}
            alt="ChildGuard logo"
            className="welcome-logo"
            />

          <div className="welcome-brand-text">
            <h1>
              Child<span>Guard</span>
            </h1>

            <p className="welcome-tagline">
              Safe Today, Bright Tomorrow
            </p>
          </div>
        </div>

        <p className="welcome-description">
          View attendance, review safety alerts and manage
          your daycare center in one place.
        </p>

        <Link to="/login" className="welcome-login-button">
          Admin Login
        </Link>

        <p className="welcome-system-name">
          Smart Child Safety and Transport Monitoring System
        </p>
      </section>
    </main>
  );
}