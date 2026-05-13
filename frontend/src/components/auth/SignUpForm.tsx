import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './SignUpForm.css';

const SignUpForm: React.FC = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    givenName: '',
    familyName: '',
    userRole: 'user',
    organization: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    // Clear error when user starts typing
    if (error) setError('');
  };

  const validateForm = () => {
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return false;
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
    if (!passwordRegex.test(formData.password)) {
      setError('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const result = await signUp({
        email: formData.email,
        password: formData.password,
        givenName: formData.givenName || undefined,
        familyName: formData.familyName || undefined,
        userRole: formData.userRole,
        organization: formData.organization || undefined,
      });

      // Navigate to confirmation page with user ID
      navigate('/auth/confirm-signup', {
        state: {
          email: formData.email,
          userId: result.userId,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="signup-container">
      <div className="signup-form-wrapper">
        <div>
          <h2 className="signup-title">
            Create your account
          </h2>
          <p className="signup-subtitle">
            Or{' '}
            <Link to="/auth/signin">
              sign in to your existing account
            </Link>
          </p>
        </div>

        <form className="signup-form" onSubmit={handleSubmit}>
          {error && (
            <div className="error-message">
              <div className="error-text">{error}</div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email address *
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={formData.email}
              onChange={handleChange}
              className="form-input"
              placeholder="Enter your email"
              disabled={isLoading}
            />
          </div>

          <div className="form-group-grid">
            <div>
              <label htmlFor="givenName" className="form-label">
                First name
              </label>
              <input
                id="givenName"
                name="givenName"
                type="text"
                autoComplete="given-name"
                value={formData.givenName}
                onChange={handleChange}
                className="form-input"
                placeholder="First name"
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="familyName" className="form-label">
                Last name
              </label>
              <input
                id="familyName"
                name="familyName"
                type="text"
                autoComplete="family-name"
                value={formData.familyName}
                onChange={handleChange}
                className="form-input"
                placeholder="Last name"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="organization" className="form-label">
              Organization
            </label>
            <input
              id="organization"
              name="organization"
              type="text"
              value={formData.organization}
              onChange={handleChange}
              className="form-input"
              placeholder="Your organization"
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="userRole" className="form-label">
              Role
            </label>
            <select
              id="userRole"
              name="userRole"
              value={formData.userRole}
              onChange={handleChange}
              className="form-select"
              disabled={isLoading}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">
              Password *
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={formData.password}
              onChange={handleChange}
              className="form-input"
              placeholder="Create a password"
              disabled={isLoading}
            />
            <p className="password-hint">
              Must be at least 8 characters with uppercase, lowercase, number, and special character
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword" className="form-label">
              Confirm password *
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={formData.confirmPassword}
              onChange={handleChange}
              className="form-input"
              placeholder="Confirm your password"
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="submit-button"
          >
            {isLoading ? (
              <div className="loading-spinner" />
            ) : (
              'Create account'
            )}
          </button>

          <div className="signin-link">
            <p>
              Already have an account?{' '}
              <Link to="/auth/signin">
                Sign in here
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SignUpForm;