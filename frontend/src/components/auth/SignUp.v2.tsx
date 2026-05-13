import { useMemo, useState } from 'react';
import { authService } from '../../services/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import './SignUp.v2.css';

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
    <div className="signup-v2-page">
      <aside className="signup-v2-brand" aria-hidden="true">
        <div className="signup-v2-brand-logo">
          <span className="signup-v2-brand-mark">H</span>
          <span>Health Data Integration Engine</span>
        </div>

        <div className="signup-v2-brand-copy">
          <span className="signup-v2-brand-eyebrow">Get started</span>
          <h1 className="signup-v2-brand-headline">
            Sign up to start automating your health data exchange.
          </h1>
          <p className="signup-v2-brand-sub">
            Be up and running in minutes — onboard your team, connect your
            systems, and start moving data securely.
          </p>

          <ul className="signup-v2-brand-bullets">
            <li>
              <span className="signup-v2-brand-tick" aria-hidden="true">
                <CheckIcon />
              </span>
              Complete audit trails for compliance and accountability
            </li>
            <li>
              <span className="signup-v2-brand-tick" aria-hidden="true">
                <CheckIcon />
              </span>
              Enterprise-grade security built in from day one
            </li>
          </ul>
        </div>

        <div className="signup-v2-brand-footer">
          © {new Date().getFullYear()} Health Data Integration Engine
        </div>
      </aside>

      <main className="signup-v2-form-panel">
        <div className="signup-v2-card">
          <div className="signup-v2-mobile-logo">
            <span className="signup-v2-mobile-mark">H</span>
            <span>Health Data Integration Engine</span>
          </div>

          <h2 className="signup-v2-title">Create your account</h2>
          <p className="signup-v2-subtitle">
            It only takes a minute. Fields marked with * are required.
          </p>

          <form className="signup-v2-form" onSubmit={handleSubmit} noValidate>
            <div className="signup-v2-row">
              <div className="signup-v2-field">
                <div className="signup-v2-label-row">
                  <label
                    htmlFor="signup-v2-givenName"
                    className="signup-v2-label"
                  >
                    First name
                  </label>
                  <span className="signup-v2-optional">Optional</span>
                </div>
                <input
                  id="signup-v2-givenName"
                  type="text"
                  name="givenName"
                  autoComplete="given-name"
                  value={formData.givenName}
                  onChange={handleChange}
                  disabled={loading}
                  placeholder="Jane"
                  className="signup-v2-input"
                />
              </div>

              <div className="signup-v2-field">
                <div className="signup-v2-label-row">
                  <label
                    htmlFor="signup-v2-familyName"
                    className="signup-v2-label"
                  >
                    Last name
                  </label>
                  <span className="signup-v2-optional">Optional</span>
                </div>
                <input
                  id="signup-v2-familyName"
                  type="text"
                  name="familyName"
                  autoComplete="family-name"
                  value={formData.familyName}
                  onChange={handleChange}
                  disabled={loading}
                  placeholder="Doe"
                  className="signup-v2-input"
                />
              </div>
            </div>

            <div className="signup-v2-field">
              <label htmlFor="signup-v2-email" className="signup-v2-label">
                Email *
              </label>
              <input
                id="signup-v2-email"
                type="email"
                inputMode="email"
                name="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
                placeholder="you@example.com"
                className="signup-v2-input"
              />
            </div>

            <div className="signup-v2-row">
              <div className="signup-v2-field">
                <label
                  htmlFor="signup-v2-password"
                  className="signup-v2-label"
                >
                  Password *
                </label>
                <div className="signup-v2-input-wrap">
                  <input
                    id="signup-v2-password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="new-password"
                    required
                    value={formData.password}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="At least 8 characters"
                    className="signup-v2-input signup-v2-input--with-suffix"
                    aria-describedby="signup-v2-strength-label"
                  />
                  <button
                    type="button"
                    className="signup-v2-suffix-btn"
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
                      className="signup-v2-strength"
                      aria-hidden="true"
                    >
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={`signup-v2-strength-bar${
                            strength.score >= i
                              ? ` signup-v2-strength-bar--${strength.score}`
                              : ''
                          }`}
                        />
                      ))}
                    </div>
                    <div
                      id="signup-v2-strength-label"
                      className="signup-v2-strength-label"
                      aria-live="polite"
                    >
                      {strength.label && `Password strength: ${strength.label}`}
                    </div>
                  </>
                )}
              </div>

              <div className="signup-v2-field">
                <label
                  htmlFor="signup-v2-confirmPassword"
                  className="signup-v2-label"
                >
                  Confirm password *
                </label>
                <div className="signup-v2-input-wrap">
                  <input
                    id="signup-v2-confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    name="confirmPassword"
                    autoComplete="new-password"
                    required
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="Re-enter password"
                    className={`signup-v2-input signup-v2-input--with-suffix${
                      passwordsMismatch ? ' signup-v2-input--invalid' : ''
                    }`}
                    aria-invalid={passwordsMismatch || undefined}
                    aria-describedby={
                      passwordsMismatch ? 'signup-v2-confirm-help' : undefined
                    }
                  />
                  <button
                    type="button"
                    className="signup-v2-suffix-btn"
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
                    id="signup-v2-confirm-help"
                    className="signup-v2-help signup-v2-help--error"
                  >
                    Passwords do not match
                  </div>
                )}
              </div>
            </div>

            <div className="signup-v2-row">
              <div className="signup-v2-field">
                <div className="signup-v2-label-row">
                  <label
                    htmlFor="signup-v2-userRole"
                    className="signup-v2-label"
                  >
                    Role
                  </label>
                  <span className="signup-v2-optional">Optional</span>
                </div>
                <select
                  id="signup-v2-userRole"
                  name="userRole"
                  value={formData.userRole}
                  onChange={handleChange}
                  disabled={loading}
                  className="signup-v2-select"
                >
                  <option value="">Select a role</option>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                </select>
              </div>

              <div className="signup-v2-field">
                <div className="signup-v2-label-row">
                  <label
                    htmlFor="signup-v2-organization"
                    className="signup-v2-label"
                  >
                    Organization
                  </label>
                  <span className="signup-v2-optional">Optional</span>
                </div>
                <input
                  id="signup-v2-organization"
                  type="text"
                  name="organization"
                  autoComplete="organization"
                  value={formData.organization}
                  onChange={handleChange}
                  disabled={loading}
                  placeholder="Acme Health"
                  className="signup-v2-input"
                />
              </div>
            </div>

            {error && (
              <div className="signup-v2-error" role="alert" aria-live="polite">
                <span className="signup-v2-error-icon" aria-hidden="true">
                  <AlertIcon />
                </span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="signup-v2-submit"
            >
              {loading ? (
                <>
                  <span className="signup-v2-spinner" aria-hidden="true" />
                  <span>Creating account…</span>
                </>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <div className="signup-v2-footer">
            Already have an account?
            <button
              type="button"
              onClick={onSwitchToSignIn}
              disabled={loading}
            >
              Sign in
            </button>
          </div>

          <p className="signup-v2-legal">
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
