import { useState } from 'react';
import { authService } from '../../services/auth';

interface ConfirmSignUpProps {
  email: string;
  password?: string;
  onConfirmSuccess: () => void;
  onBackToSignUp: () => void;
}

export default function ConfirmSignUp({ email, password, onConfirmSuccess, onBackToSignUp }: ConfirmSignUpProps) {
  const [confirmationCode, setConfirmationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await authService.confirmSignUp({ username: email, confirmationCode });
      
      // Auto sign-in if password is available
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

    try {
      await authService.resendSignUpCode(email);
      setError('Verification code sent successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Confirm Your Email</h2>
        <p>We've sent a verification code to <strong>{email}</strong></p>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="confirmationCode">Verification Code</label>
            <input
              type="text"
              id="confirmationCode"
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value)}
              required
              disabled={loading}
              placeholder="Enter 6-digit code"
            />
          </div>

          {error && (
            <div className={error.includes('successfully') ? 'success-message' : 'error-message'}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="auth-button">
            {loading ? 'Confirming...' : 'Confirm Email'}
          </button>
        </form>

        <div className="auth-links">
          <button onClick={handleResendCode} disabled={resending} className="link-button">
            {resending ? 'Sending...' : 'Resend Code'}
          </button>
          <button onClick={onBackToSignUp} className="link-button">
            Back to Sign Up
          </button>
        </div>
      </div>
    </div>
  );
}