import { useMemo, useState } from 'react';
import { authService } from '../../services/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import './ForgotPassword.v2.css';

interface ForgotPasswordProps {
  onBackToSignIn: () => void;
}

type Step = 'request' | 'confirm';

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

export default function ForgotPassword({
  onBackToSignIn,
}: ForgotPasswordProps) {
  useDocumentTitle('Reset password');
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(
    () => evaluatePasswordStrength(newPassword),
    [newPassword]
  );

  const passwordsMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await authService.resetPassword(email);
      setStep('confirm');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to send reset code'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      await authService.confirmResetPassword({
        username: email,
        confirmationCode,
        newPassword,
      });
      onBackToSignIn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to reset password'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-v2-page">
      <div className="forgot-v2-card">
        <div className="forgot-v2-logo">
          <span className="forgot-v2-logo-mark">H</span>
          <span>Health Data Integration Engine</span>
        </div>

        <Stepper step={step} />

        {step === 'request' ? (
          <>
            <div className="forgot-v2-icon-wrap" aria-hidden="true">
              <KeyIcon />
            </div>
            <h2 className="forgot-v2-title">Forgot your password?</h2>
            <p className="forgot-v2-subtitle">
              Enter the email associated with your account and we'll send a
              code to reset your password.
            </p>

            <form
              className="forgot-v2-form"
              onSubmit={handleRequestReset}
              noValidate
            >
              <div className="forgot-v2-field">
                <label
                  htmlFor="forgot-v2-email"
                  className="forgot-v2-label"
                >
                  Email
                </label>
                <input
                  id="forgot-v2-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  required
                  disabled={loading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="forgot-v2-input"
                />
              </div>

              {error && (
                <div
                  className="forgot-v2-error"
                  role="alert"
                  aria-live="polite"
                >
                  <span className="forgot-v2-error-icon" aria-hidden="true">
                    <AlertIcon />
                  </span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="forgot-v2-submit"
              >
                {loading ? (
                  <>
                    <span
                      className="forgot-v2-spinner"
                      aria-hidden="true"
                    />
                    <span>Sending code…</span>
                  </>
                ) : (
                  'Send reset code'
                )}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="forgot-v2-icon-wrap" aria-hidden="true">
              <ShieldIcon />
            </div>
            <h2 className="forgot-v2-title">Set a new password</h2>
            <p className="forgot-v2-subtitle">
              Enter the code sent to <strong>{email}</strong> and choose a
              new password.
            </p>

            <form
              className="forgot-v2-form"
              onSubmit={handleConfirmReset}
              noValidate
            >
              <div className="forgot-v2-field">
                <label
                  htmlFor="forgot-v2-code"
                  className="forgot-v2-label"
                >
                  Reset code
                </label>
                <input
                  id="forgot-v2-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  disabled={loading}
                  value={confirmationCode}
                  onChange={(e) =>
                    setConfirmationCode(e.target.value.trim())
                  }
                  placeholder="000000"
                  maxLength={10}
                  className="forgot-v2-input forgot-v2-input--code"
                />
              </div>

              <div className="forgot-v2-field">
                <label
                  htmlFor="forgot-v2-new-password"
                  className="forgot-v2-label"
                >
                  New password
                </label>
                <div className="forgot-v2-input-wrap">
                  <input
                    id="forgot-v2-new-password"
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    disabled={loading}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="forgot-v2-input forgot-v2-input--with-suffix"
                  />
                  <button
                    type="button"
                    className="forgot-v2-suffix-btn"
                    onClick={() => setShowNew((s) => !s)}
                    aria-label={
                      showNew ? 'Hide password' : 'Show password'
                    }
                    aria-pressed={showNew}
                    tabIndex={loading ? -1 : 0}
                  >
                    {showNew ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {newPassword && (
                  <div className="forgot-v2-help">
                    Strength: <strong>{strength.label}</strong>
                  </div>
                )}
              </div>

              <div className="forgot-v2-field">
                <label
                  htmlFor="forgot-v2-confirm-password"
                  className="forgot-v2-label"
                >
                  Confirm new password
                </label>
                <div className="forgot-v2-input-wrap">
                  <input
                    id="forgot-v2-confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    disabled={loading}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className={`forgot-v2-input forgot-v2-input--with-suffix${
                      passwordsMismatch ? ' forgot-v2-input--invalid' : ''
                    }`}
                    aria-invalid={passwordsMismatch || undefined}
                  />
                  <button
                    type="button"
                    className="forgot-v2-suffix-btn"
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
                  <div className="forgot-v2-help forgot-v2-help--error">
                    Passwords do not match
                  </div>
                )}
              </div>

              {error && (
                <div
                  className="forgot-v2-error"
                  role="alert"
                  aria-live="polite"
                >
                  <span className="forgot-v2-error-icon" aria-hidden="true">
                    <AlertIcon />
                  </span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="forgot-v2-submit"
              >
                {loading ? (
                  <>
                    <span
                      className="forgot-v2-spinner"
                      aria-hidden="true"
                    />
                    <span>Resetting…</span>
                  </>
                ) : (
                  'Reset password'
                )}
              </button>
            </form>
          </>
        )}

        <div className="forgot-v2-back">
          {step === 'confirm' ? (
            <button
              type="button"
              onClick={() => {
                setStep('request');
                setError(null);
              }}
              disabled={loading}
            >
              ← Use a different email
            </button>
          ) : (
            <button type="button" onClick={onBackToSignIn} disabled={loading}>
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <div className="forgot-v2-stepper" aria-hidden="true">
      <span
        className={`forgot-v2-stepper-dot ${
          step === 'request'
            ? 'forgot-v2-stepper-dot--active'
            : 'forgot-v2-stepper-dot--done'
        }`}
      >
        1
      </span>
      <span
        className={`forgot-v2-stepper-bar${
          step === 'confirm' ? ' forgot-v2-stepper-bar--done' : ''
        }`}
      />
      <span
        className={`forgot-v2-stepper-dot ${
          step === 'confirm' ? 'forgot-v2-stepper-dot--active' : ''
        }`}
      >
        2
      </span>
      <span style={{ marginLeft: 8 }}>
        {step === 'request' ? 'Request code' : 'Set new password'}
      </span>
    </div>
  );
}

/* ---------- Inline SVG icons ---------- */

function KeyIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4" />
      <path d="m10.85 12.15 8.15-8.15" />
      <path d="m18 5 3 3" />
      <path d="m15 8 3 3" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
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
