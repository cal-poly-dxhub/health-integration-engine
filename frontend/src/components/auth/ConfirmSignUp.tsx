import { useState } from 'react';
import { authService } from '../../services/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import './ConfirmSignUp.css';

interface ConfirmSignUpProps {
  email: string;
  password?: string;
  onConfirmSuccess: () => void;
  onBackToSignUp: () => void;
}

export default function ConfirmSignUp({
  email,
  password,
  onConfirmSuccess,
  onBackToSignUp,
}: ConfirmSignUpProps) {
  useDocumentTitle('Verify email');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await authService.confirmSignUp({ username: email, confirmationCode });

      if (password) {
        await authService.signIn({ email, password });
      }

      onConfirmSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setResending(true);
    setError(null);
    setSuccess(null);

    try {
      await authService.resendSignUpCode(email);
      setSuccess('Verification code sent successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="confirm-page">
      <div className="confirm-card">
        <div className="confirm-logo">
          <span className="confirm-logo-mark">H</span>
          <span>Health Data Integration Engine</span>
        </div>

        <div className="confirm-icon-wrap" aria-hidden="true">
          <MailCheckIcon />
        </div>

        <h2 className="confirm-title">Verify your email</h2>
        <p className="confirm-subtitle">
          We sent a 6-digit code to
        </p>
        <p className="confirm-email">{email}</p>

        <form className="confirm-form" onSubmit={handleSubmit} noValidate>
          <div className="confirm-field">
            <label
              htmlFor="confirm-code"
              className="confirm-label"
            >
              Verification code
            </label>
            <input
              id="confirm-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              disabled={loading}
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value.trim())}
              placeholder="000000"
              maxLength={10}
              className="confirm-input"
            />
          </div>

          {error && (
            <div
              className="confirm-banner confirm-banner--error"
              role="alert"
              aria-live="polite"
            >
              <span className="confirm-banner-icon" aria-hidden="true">
                <AlertIcon />
              </span>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div
              className="confirm-banner confirm-banner--success"
              role="status"
              aria-live="polite"
            >
              <span className="confirm-banner-icon" aria-hidden="true">
                <CheckCircleIcon />
              </span>
              <span>{success}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="confirm-submit"
          >
            {loading ? (
              <>
                <span className="confirm-spinner" aria-hidden="true" />
                <span>Verifying…</span>
              </>
            ) : (
              'Verify email'
            )}
          </button>
        </form>

        <div className="confirm-actions">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={resending || loading}
            className="confirm-resend"
          >
            {resending ? (
              'Sending new code…'
            ) : (
              <>
                Didn't get the code? <strong>Resend</strong>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onBackToSignUp}
            disabled={loading}
            className="confirm-back"
          >
            ← Back to sign up
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Inline SVG icons ---------- */

function MailCheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11" />
      <path d="m3 7 9 6 5-3.4" />
      <path d="m16 13 2 2 5-5" />
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

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
