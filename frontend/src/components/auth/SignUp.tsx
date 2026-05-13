import { useMemo, useState } from 'react';
import { authService } from '../../services/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import './SignUp.css';

interface SignUpProps {
  onSignUpSuccess: (email: string, password: string) => void;
  onSwitchToSignIn: () => void;
}

interface FormState {
  email: string;
  password: string;
  confirmPassword: string;
  givenName: string;
  familyName: string;
  userRole: string;
  organization: string;
}

const INITIAL_FORM: FormState = {
  email: '',
  password: '',
  confirmPassword: '',
  givenName: '',
  familyName: '',
  userRole: '',
  organization: '',
};

function evaluatePasswordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  if (!password) return { score: 0, label: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const labels = ['', 'weak', 'fair', 'good', 'strong'];
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score] };
}

export default function SignUp({
  onSignUpSuccess,
  onSwitchToSignIn,
}: SignUpProps) {
  useDocumentTitle('Create account');
  const [formData, setFormData] = useState<FormState>(INITIAL_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(
    () => evaluatePasswordStrength(formData.password),
    [formData.password]
  );

  const passwordsMismatch =
    formData.confirmPassword.length > 0 &&
    formData.password !== formData.confirmPassword;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      await authService.signUp({
        email: formData.email,
        password: formData.password,
        givenName: formData.givenName || undefined,
        familyName: formData.familyName || undefined,
        userRole: formData.userRole || undefined,
        organization: formData.organization || undefined,
      });
      onSignUpSuccess(formData.email, formData.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-page">
      <aside className="signup-brand" aria-hidden="true">
        <div className="signup-brand-logo">
          <span className="signup-brand-mark">H</span>
          <span>Health Data Integration Engine</span>
        </div>

        <div className="signup-brand-copy">
          <span className="signup-brand-eyebrow">Get started</span>
          <h1 className="signup-brand-headline">
            Sign up to start automating your health data exchange.
          </h1>
          <p className="signup-brand-sub">
            Be up and running in minutes — onboard your team, connect your
            systems, and start moving data securely.
          </p>

          <ul className="signup-brand-bullets">
            <li>
              <span className="signup-brand-tick" aria-hidden="true">
                <CheckIcon />
              </span>
              Complete audit trails for compliance and accountability
            </li>
            <li>
              <span className="signup-brand-tick" aria-hidden="true">
                <CheckIcon />
              </span>
              Enterprise-grade security built in from day one
            </li>
          </ul>
        </div>

        <div className="signup-brand-footer">
          © {new Date().getFullYear()} Health Data Integration Engine
        </div>
      </aside>

      <main className="signup-form-panel">
        <div className="signup-card">
          <div className="signup-mobile-logo">
            <span className="signup-mobile-mark">H</span>
            <span>Health Data Integration Engine</span>
          </div>

          <h2 className="signup-title">Create your account</h2>
          <p className="signup-subtitle">
            It only takes a minute. Fields marked with * are required.
          </p>

          <form className="signup-form" onSubmit={handleSubmit} noValidate>
            <div className="signup-row">
              <div className="signup-field">
                <div className="signup-label-row">
                  <label
                    htmlFor="signup-givenName"
                    className="signup-label"
                  >
                    First name
                  </label>
                  <span className="signup-optional">Optional</span>
                </div>
                <input
                  id="signup-givenName"
                  type="text"
                  name="givenName"
                  autoComplete="given-name"
                  value={formData.givenName}
                  onChange={handleChange}
                  disabled={loading}
                  placeholder="Jane"
                  className="signup-input"
                />
              </div>

              <div className="signup-field">
                <div className="signup-label-row">
                  <label
                    htmlFor="signup-familyName"
                    className="signup-label"
                  >
                    Last name
                  </label>
                  <span className="signup-optional">Optional</span>
                </div>
                <input
                  id="signup-familyName"
                  type="text"
                  name="familyName"
                  autoComplete="family-name"
                  value={formData.familyName}
                  onChange={handleChange}
                  disabled={loading}
                  placeholder="Doe"
                  className="signup-input"
                />
              </div>
            </div>

            <div className="signup-field">
              <label htmlFor="signup-email" className="signup-label">
                Email *
              </label>
              <input
                id="signup-email"
                type="email"
                inputMode="email"
                name="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
                placeholder="you@example.com"
                className="signup-input"
              />
            </div>

            <div className="signup-row">
              <div className="signup-field">
                <label
                  htmlFor="signup-password"
                  className="signup-label"
                >
                  Password *
                </label>
                <div className="signup-input-wrap">
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="new-password"
                    required
                    value={formData.password}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="At least 8 characters"
                    className="signup-input signup-input--with-suffix"
                    aria-describedby="signup-strength-label"
                  />
                  <button
                    type="button"
                    className="signup-suffix-btn"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    aria-pressed={showPassword}
                    tabIndex={loading ? -1 : 0}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {formData.password && (
                  <>
                    <div
                      className="signup-strength"
                      aria-hidden="true"
                    >
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={`signup-strength-bar${
                            strength.score >= i
                              ? ` signup-strength-bar--${strength.score}`
                              : ''
                          }`}
                        />
                      ))}
                    </div>
                    <div
                      id="signup-strength-label"
                      className="signup-strength-label"
                      aria-live="polite"
                    >
                      {strength.label && `Password strength: ${strength.label}`}
                    </div>
                  </>
                )}
              </div>

              <div className="signup-field">
                <label
                  htmlFor="signup-confirmPassword"
                  className="signup-label"
                >
                  Confirm password *
                </label>
                <div className="signup-input-wrap">
                  <input
                    id="signup-confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    name="confirmPassword"
                    autoComplete="new-password"
                    required
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="Re-enter password"
                    className={`signup-input signup-input--with-suffix${
                      passwordsMismatch ? ' signup-input--invalid' : ''
                    }`}
                    aria-invalid={passwordsMismatch || undefined}
                    aria-describedby={
                      passwordsMismatch ? 'signup-confirm-help' : undefined
                    }
                  />
                  <button
                    type="button"
                    className="signup-suffix-btn"
                    onClick={() => setShowConfirm((s) => !s)}
                    aria-label={
                      showConfirm ? 'Hide password' : 'Show password'
                    }
                    aria-pressed={showConfirm}
                    tabIndex={loading ? -1 : 0}
                  >
                    {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {passwordsMismatch && (
                  <div
                    id="signup-confirm-help"
                    className="signup-help signup-help--error"
                  >
                    Passwords do not match
                  </div>
                )}
              </div>
            </div>

            <div className="signup-row">
              <div className="signup-field">
                <div className="signup-label-row">
                  <label
                    htmlFor="signup-userRole"
                    className="signup-label"
                  >
                    Role
                  </label>
                  <span className="signup-optional">Optional</span>
                </div>
                <select
                  id="signup-userRole"
                  name="userRole"
                  value={formData.userRole}
                  onChange={handleChange}
                  disabled={loading}
                  className="signup-select"
                >
                  <option value="">Select a role</option>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                </select>
              </div>

              <div className="signup-field">
                <div className="signup-label-row">
                  <label
                    htmlFor="signup-organization"
                    className="signup-label"
                  >
                    Organization
                  </label>
                  <span className="signup-optional">Optional</span>
                </div>
                <input
                  id="signup-organization"
                  type="text"
                  name="organization"
                  autoComplete="organization"
                  value={formData.organization}
                  onChange={handleChange}
                  disabled={loading}
                  placeholder="Acme Health"
                  className="signup-input"
                />
              </div>
            </div>

            {error && (
              <div className="signup-error" role="alert" aria-live="polite">
                <span className="signup-error-icon" aria-hidden="true">
                  <AlertIcon />
                </span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="signup-submit"
            >
              {loading ? (
                <>
                  <span className="signup-spinner" aria-hidden="true" />
                  <span>Creating account…</span>
                </>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <div className="signup-footer">
            Already have an account?
            <button
              type="button"
              onClick={onSwitchToSignIn}
              disabled={loading}
            >
              Sign in
            </button>
          </div>

          <p className="signup-legal">
            By creating an account, you agree to your organization's terms of
            use and data handling policy.
          </p>
        </div>
      </main>
    </div>
  );
}

/* ---------- Inline SVG icons ---------- */

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
