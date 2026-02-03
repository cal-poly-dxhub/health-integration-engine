import { useState } from 'react';
import { authService } from '../../services/auth';

interface SignInProps {
  onSignInSuccess: () => void;
  onSwitchToSignUp: () => void;
  onSwitchToForgotPassword: () => void;
}

export default function SignIn({ onSignInSuccess, onSwitchToSignUp, onSwitchToForgotPassword }: SignInProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await authService.signIn({ email, password });
      onSignInSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Sign In</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading} className="auth-button">
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="auth-links">
          <button onClick={onSwitchToForgotPassword} className="link-button">
            Forgot Password?
          </button>
          <button onClick={onSwitchToSignUp} className="link-button">
            Don't have an account? Sign Up
          </button>
        </div>
      </div>
    </div>
  );
}