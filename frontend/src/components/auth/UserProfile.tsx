import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Link } from 'react-router-dom';
import './UserProfile.css';

const UserProfile: React.FC = () => {
  const { user, updateProfile, updatePassword, isLoading } = useAuth();
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [profileData, setProfileData] = useState({
    email: user?.email || '',
    givenName: user?.username?.split(' ')[0] || '',
    familyName: user?.username?.split(' ')[1] || '',
    userRole: user?.userRole || 'user',
    organization: user?.organization || '',
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ 
          width: '2rem', 
          height: '2rem', 
          border: '2px solid #e5e7eb', 
          borderTop: '2px solid #3b82f6', 
          borderRadius: '50%', 
          animation: 'spin 1s linear infinite' 
        }}></div>
      </div>
    );
  }

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setProfileData(prev => ({
      ...prev,
      [name]: value,
    }));
    if (profileError) setProfileError('');
    if (profileSuccess) setProfileSuccess('');
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({
      ...prev,
      [name]: value,
    }));
    if (passwordError) setPasswordError('');
    if (passwordSuccess) setPasswordSuccess('');
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setIsUpdatingProfile(true);

    try {
      await updateProfile({
        email: profileData.email,
        givenName: profileData.givenName,
        familyName: profileData.familyName,
        userRole: profileData.userRole,
        organization: profileData.organization,
      });
      setProfileSuccess('Profile updated successfully!');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      return;
    }

    setIsUpdatingPassword(true);

    try {
      await updatePassword(passwordData.currentPassword, passwordData.newPassword);
      setPasswordSuccess('Password updated successfully!');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="profile-container">
      <div className="profile-content">
        <Link to="/dashboard" className="back-link">
          ← Back to Dashboard
        </Link>

        <div className="profile-card">
          {/* User Info Summary */}
          <div className="profile-header">
            <div className="profile-header-flex">
              <div className="profile-avatar">
                <div className="avatar-circle">
                  <span className="avatar-text">
                    {user?.username?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="profile-info">
                <h2 className="profile-name">
                  {user?.username || 'User'}
                </h2>
                <p className="profile-email">{user?.email}</p>
                <div className="profile-badges">
                  <span className={`badge ${user?.emailVerified ? 'badge-verified' : 'badge-unverified'}`}>
                    {user?.emailVerified ? 'Verified' : 'Unverified'}
                  </span>
                  <span className="badge badge-role">
                    {user?.userRole || 'User'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="profile-body">
            {/* Profile Information Section */}
            <div className="section">
              <h3 className="section-title">Profile Information</h3>
              
              {profileError && (
                <div className="error-message">
                  <div className="error-text">{profileError}</div>
                </div>
              )}

              {profileSuccess && (
                <div className="success-message">
                  <div className="success-text">{profileSuccess}</div>
                </div>
              )}

              <form onSubmit={handleProfileSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="email" className="form-label">
                      Email Address
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      value={profileData.email}
                      onChange={handleProfileChange}
                      className="form-input"
                      disabled={isUpdatingProfile}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="userRole" className="form-label">
                      Role
                    </label>
                    <select
                      id="userRole"
                      name="userRole"
                      value={profileData.userRole}
                      onChange={handleProfileChange}
                      className="form-select"
                      disabled={isUpdatingProfile}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="givenName" className="form-label">
                      First Name
                    </label>
                    <input
                      id="givenName"
                      name="givenName"
                      type="text"
                      value={profileData.givenName}
                      onChange={handleProfileChange}
                      className="form-input"
                      disabled={isUpdatingProfile}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="familyName" className="form-label">
                      Last Name
                    </label>
                    <input
                      id="familyName"
                      name="familyName"
                      type="text"
                      value={profileData.familyName}
                      onChange={handleProfileChange}
                      className="form-input"
                      disabled={isUpdatingProfile}
                    />
                  </div>

                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="organization" className="form-label">
                      Organization
                    </label>
                    <input
                      id="organization"
                      name="organization"
                      type="text"
                      value={profileData.organization}
                      onChange={handleProfileChange}
                      className="form-input"
                      disabled={isUpdatingProfile}
                    />
                  </div>
                </div>

                <div className="button-group">
                  <button
                    type="submit"
                    disabled={isUpdatingProfile}
                    className="button button-primary"
                  >
                    {isUpdatingProfile ? (
                      <div style={{ 
                        width: '1rem', 
                        height: '1rem', 
                        border: '2px solid transparent', 
                        borderTop: '2px solid currentColor', 
                        borderRadius: '50%', 
                        animation: 'spin 1s linear infinite' 
                      }}></div>
                    ) : (
                      'Update Profile'
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Password Change Section */}
            <div className="section">
              <h3 className="section-title">Change Password</h3>
              
              {passwordError && (
                <div className="error-message">
                  <div className="error-text">{passwordError}</div>
                </div>
              )}

              {passwordSuccess && (
                <div className="success-message">
                  <div className="success-text">{passwordSuccess}</div>
                </div>
              )}

              <form onSubmit={handlePasswordSubmit}>
                <div className="form-group">
                  <label htmlFor="currentPassword" className="form-label">
                    Current Password
                  </label>
                  <input
                    id="currentPassword"
                    name="currentPassword"
                    type="password"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordChange}
                    className="form-input"
                    disabled={isUpdatingPassword}
                    required
                  />
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="newPassword" className="form-label">
                      New Password
                    </label>
                    <input
                      id="newPassword"
                      name="newPassword"
                      type="password"
                      value={passwordData.newPassword}
                      onChange={handlePasswordChange}
                      className="form-input"
                      disabled={isUpdatingPassword}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="confirmPassword" className="form-label">
                      Confirm New Password
                    </label>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      value={passwordData.confirmPassword}
                      onChange={handlePasswordChange}
                      className="form-input"
                      disabled={isUpdatingPassword}
                      required
                    />
                  </div>
                </div>

                <div className="button-group">
                  <button
                    type="submit"
                    disabled={isUpdatingPassword}
                    className="button button-primary"
                  >
                    {isUpdatingPassword ? (
                      <div style={{ 
                        width: '1rem', 
                        height: '1rem', 
                        border: '2px solid transparent', 
                        borderTop: '2px solid currentColor', 
                        borderRadius: '50%', 
                        animation: 'spin 1s linear infinite' 
                      }}></div>
                    ) : (
                      'Update Password'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;