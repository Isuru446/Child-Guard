import { useContext, useRef, useState } from 'react';
import { CookieAdminSessionContext } from '../lib/admin-session-context';
import { adminDestination } from '../lib/admin-navigation';
import { api, clearSession, setToken } from '../lib/api';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  UserRound,
} from 'lucide-react';

import logo from '../assets/logo.png';
import '../style/AdminLogin.css';

const FACEBOOK_URL = '';
const INSTAGRAM_URL = '';

function FacebookIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5H17V3.9c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5V10H7v3h3v8h3.5Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle
        cx="17.5"
        cy="6.5"
        r="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function SocialLink({ href, label, children }) {
  if (!href) {
    return (
      <span className="login-social-link">
        {children}
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="login-social-link"
      aria-label={`ChildGuard on ${label} (opens in a new tab)`}
    >
      {children}
      {label}
    </a>
  );
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const session = useContext(CookieAdminSessionContext);
  const location = useLocation();
  const submitting = useRef(false);
  const [loading, setLoading] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(location.state?.sessionMessage || '');

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter your username and password.');
      return;
    }

    submitting.current = true;
    setLoading(true);
    try {
      if(session) {
        await session.login(username.trim(),password);
        navigate(adminDestination(location.state?.returnTo),{replace:true});
        return;
      }
      clearSession();
      const result = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) });
      if (result?.user?.role !== 'ADMIN') throw new Error('An administrator account is required for this dashboard.');
      if (typeof result.token !== 'string' || !result.token.trim()) throw new Error('Unexpected sign-in response. Please try again.');
      setToken(result.token);
      navigate(adminDestination(location.state?.returnTo), { replace: true });
    } catch (failure) { setError(failure.message); }
    finally { submitting.current = false; setLoading(false); }
  }

  return (
    <main className="cg-auth-page admin-login-page">
      <section className="login-card">
        <header className="login-header">
          <Link to="/" className="login-back">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to welcome
          </Link>

          <div className="login-brand">
            <img
              src={logo}
              alt="ChildGuard logo"
              className="login-logo"
            />

            <div className="login-brand-text">
              <h1>
                Child<span>Guard</span>
              </h1>
              <p>Safe today, bright tomorrow</p>
            </div>
          </div>
        </header>

        <div className="login-body">
          <div className="login-heading">
            <h2>Admin Login</h2>
            <p>Sign in to your account</p>
          </div>

          <p id="admin-login-help" className="cg-field-help">Use your Admin account. Parents and Teachers sign in through the ChildGuard mobile app.</p>
          <form aria-describedby="admin-login-help" className="login-form" onSubmit={handleSubmit} aria-busy={loading}>
            <div className="login-field">
              <label htmlFor="admin-username">Username</label>

              <div className="login-input-wrap">
                <UserRound
                  size={19}
                  className="login-input-icon"
                  aria-hidden="true"
                />

                <input
                  id="admin-username"
                  name="username"
                  type="text"
                  placeholder="Enter your username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  disabled={loading}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setError('');
                  }}
                  required
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="admin-password">Password</label>

              <div className="login-input-wrap">
                <LockKeyhole
                  size={19}
                  className="login-input-icon"
                  aria-hidden="true"
                />

                <input
                  id="admin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={password}
                  disabled={loading}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError('');
                  }}
                  required
                />

                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() =>
                    setShowPassword((previous) => !previous)
                  }
                  aria-label={
                    showPassword ? 'Hide password' : 'Show password'
                  }
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff size={19} aria-hidden="true" />
                  ) : (
                    <Eye size={19} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          

          <p className="login-footer">
            Smart Child Safety and Transport Monitoring System
          </p>
        </div>
      </section>
    </main>
  );
}
