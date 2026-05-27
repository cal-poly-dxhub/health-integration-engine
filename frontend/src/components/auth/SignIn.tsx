import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import './SignIn.css';

interface SignInProps {
  onSignInSuccess: () => void;
  onSwitchToSignUp: () => void;
  onSwitchToForgotPassword: () => void;
}

export default function SignIn({
  onSignInSuccess,
  onSwitchToSignUp,
  onSwitchToForgotPassword,
}: SignInProps) {
  useDocumentTitle('Sign in');
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await signIn(email, password);
      onSignInSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signin-page">
      <aside className="signin-brand" aria-hidden="true">
        <div className="signin-brand-logo">
          <span className="signin-brand-mark">H</span>
          <span>Health Data Integration Engine</span>
        </div>

        <div className="signin-brand-copy">
          <span className="signin-brand-eyebrow">
            Data Integration Platform
          </span>
          <h1 className="signin-brand-headline">
            Build, automate, and track your health data — all in one place.
          </h1>
          <p className="signin-brand-sub">
            A single workspace to design workflows, manage processing tasks,
            and bring clinical data sources together — with built-in security
            and compliance.
          </p>

          <ul className="signin-brand-bullets">
            <li>
              <span className="signin-brand-tick" aria-hidden="true">
                <CheckIcon />
              </span>
              Drag-and-drop workflow designer with version history and easy
              re-runs
            </li>
            <li>
              <span className="signin-brand-tick" aria-hidden="true">
                <CheckIcon />
              </span>
              Enterprise-grade security, access controls, and network
              isolation built in
            </li>
            <li>
              <span className="signin-brand-tick" aria-hidden="true">
                <CheckIcon />
              </span>
              Complete audit trail and real-time status tracking for every
              workflow
            </li>
          </ul>
        </div>

        <div className="signin-brand-footer">
          © {new Date().getFullYear()} Health Data Integration Engine
        </div>
      </aside>

      <main className="signin-form-panel">
        <div className="signin-card">
          <div className="signin-mobile-logo">
            <span className="signin-mobile-mark">H</span>
            <span>Health Data Integration Engine</span>
          </div>

          <h2 className="signin-title">Welcome back</h2>
          <p className="signin-subtitle">
            Sign in to access your workflows and integrations.
          </p>

          <form className="signin-form" onSubmit={handleSubmit} noValidate>
            <div className="signin-field">
              <div className="signin-label-row">
                <label htmlFor="signin-email" className="signin-label">
                  Email
                </label>
              </div>
              <div className="signin-input-wrap">
                <span className="signin-input-icon" aria-hidden="true">
                  <MailIcon />
                </span>
                <input
                  id="signin-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  required
                  disabled={loading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="signin-input"
                />
              </div>
            </div>

            <div className="signin-field">
              <div className="signin-label-row">
                <label htmlFor="signin-password" className="signin-label">
                  Password
                </label>
                <button
                  type="button"
                  className="signin-inline-link"
                  onClick={onSwitchToForgotPassword}
                  disabled={loading}
                >
                  Forgot password?
                </button>
              </div>
              <div className="signin-input-wrap">
                <span className="signin-input-icon" aria-hidden="true">
                  <LockIcon />
                </span>
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="signin-input signin-input--with-suffix"
                />
                <button
                  type="button"
                  className="signin-suffix-btn"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  tabIndex={loading ? -1 : 0}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {error && (
              <div className="signin-error" role="alert" aria-live="polite">
                <span className="signin-error-icon" aria-hidden="true">
                  <AlertIcon />
                </span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="signin-submit"
            >
              {loading ? (
                <>
                  <span className="signin-spinner" aria-hidden="true" />
                  <span>Signing in…</span>
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="signin-footer">
            Don't have an account?
            <button
              type="button"
              onClick={onSwitchToSignUp}
              disabled={loading}
            >
              Create one
            </button>
          </div>

          <p className="signin-legal">
            By signing in, you agree to your organization's terms of use and
            data handling policy.
          </p>
        </div>
      </main>
    </div>
  );
}

/* ---------- Inline SVG icons (no extra deps) ---------- */

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a17.7 17.7 0 0 1-3.2 4" />
      <path d="M6.1 6.1C3.4 7.9 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
