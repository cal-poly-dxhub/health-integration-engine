import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { authService, decodeJwtExp, type AuthUser, type AuthTokens } from '../services/auth';

// Sign the user out locally after this much inactivity. Cognito has no native
// idle expiry, so we enforce one client-side to limit the unattended-session
// risk (and align with healthcare session norms).
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
// Refresh the access token this long before it expires so requests never race
// expiry. Mirrors the skew used inside authService.getTokens().
const REFRESH_SKEW_MS = 2 * 60 * 1000;

interface AuthContextType {
  user: AuthUser | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (userData: {
    email: string;
    password: string;
    givenName?: string;
    familyName?: string;
  }) => Promise<{ userId: string; nextStep: any }>;
  signOut: () => Promise<void>;
  confirmSignUp: (username: string, code: string) => Promise<void>;
  resendSignUpCode: (username: string) => Promise<void>;
  resetPassword: (username: string) => Promise<void>;
  confirmResetPassword: (username: string, code: string, newPassword: string) => Promise<void>;
  updatePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  updateProfile: (profile: {
    email?: string;
    givenName?: string;
    familyName?: string;
  }) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  config: {
    userPoolId: string;
    userPoolClientId: string;
    identityPoolId: string;
    region: string;
    domain?: string;
  };
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children, config }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Configure auth service on mount
  useEffect(() => {
    try {
      console.log('Configuring auth service...');
      authService.configure(config);
      checkAuthState();
    } catch (error) {
      console.error('Failed to configure auth service:', error);
      // Set loading to false so the app can still render
      setIsLoading(false);
      setIsAuthenticated(false);
    }
  }, [config]);

  // Check initial authentication state
  const checkAuthState = async () => {
    try {
      setIsLoading(true);
      const authenticated = await authService.isAuthenticated();
      
      if (authenticated) {
        const [currentUser, currentTokens] = await Promise.all([
          authService.getCurrentUser(),
          authService.getTokens(),
        ]);
        
        setUser(currentUser);
        setTokens(currentTokens);
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setTokens(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth state check failed:', error);
      setUser(null);
      setTokens(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Sign in
  const signIn = async (email: string, password: string) => {
    try {
      const result = await authService.signIn({ email, password });

      setUser(result.user);
      setTokens(result.tokens);
      setIsAuthenticated(true);
    } catch (error) {
      setUser(null);
      setTokens(null);
      setIsAuthenticated(false);
      throw error;
    }
  };

  // Sign up
  const signUp = async (userData: {
    email: string;
    password: string;
    givenName?: string;
    familyName?: string;
  }) => {
    try {
      setIsLoading(true);
      return await authService.signUp(userData);
    } finally {
      setIsLoading(false);
    }
  };

  // Sign out — clear state immediately so subsequent auth checks see a clean slate
  const signOut = async () => {
    setUser(null);
    setTokens(null);
    setIsAuthenticated(false);
    try {
      await authService.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  // Confirm sign up
  const confirmSignUp = async (username: string, code: string) => {
    try {
      setIsLoading(true);
      await authService.confirmSignUp({ username, confirmationCode: code });
    } finally {
      setIsLoading(false);
    }
  };

  // Resend sign up code
  const resendSignUpCode = async (username: string) => {
    await authService.resendSignUpCode(username);
  };

  // Reset password
  const resetPassword = async (username: string) => {
    await authService.resetPassword(username);
  };

  // Confirm reset password
  const confirmResetPassword = async (username: string, code: string, newPassword: string) => {
    await authService.confirmResetPassword({
      username,
      confirmationCode: code,
      newPassword,
    });
  };

  // Update password
  const updatePassword = async (oldPassword: string, newPassword: string) => {
    await authService.updatePassword(oldPassword, newPassword);
  };

  // Update profile
  const updateProfile = async (profile: {
    email?: string;
    givenName?: string;
    familyName?: string;
  }) => {
    try {
      setIsLoading(true);
      await authService.updateUserProfile(profile);
      
      // Refresh user data
      const updatedUser = await authService.getCurrentUser();
      setUser(updatedUser);
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh user data
  const refreshUser = async () => {
    try {
      if (isAuthenticated) {
        const [currentUser, currentTokens] = await Promise.all([
          authService.getCurrentUser(),
          authService.getTokens(),
        ]);
        
        setUser(currentUser);
        setTokens(currentTokens);
      }
    } catch (error) {
      console.error('Refresh user error:', error);
      // If refresh fails, user might be signed out
      await signOut();
    }
  };

  // Proactive token refresh: schedule a refresh shortly before the current
  // access token expires (tokens are short-lived — 15 min — so a fixed
  // interval no longer fits). Reschedules whenever the token changes.
  useEffect(() => {
    if (!isAuthenticated || !tokens) return;

    const exp = decodeJwtExp(tokens.accessToken); // seconds since epoch
    // If we can't read expiry, fall back to refreshing in ~13 min.
    const msUntilExpiry = exp !== null ? exp * 1000 - Date.now() : 13 * 60 * 1000;
    const delay = Math.max(0, msUntilExpiry - REFRESH_SKEW_MS);

    const timer = setTimeout(async () => {
      try {
        const newTokens = await authService.refreshTokens();
        setTokens(newTokens);
      } catch (error) {
        console.error('Token refresh failed:', error);
        await signOut();
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [isAuthenticated, tokens]);

  // Idle timeout: sign out locally after IDLE_TIMEOUT_MS without user activity.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isAuthenticated) return;

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        console.warn('Session idle timeout reached; signing out.');
        signOut();
      }, IDLE_TIMEOUT_MS);
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      'mousedown', 'keydown', 'scroll', 'touchstart', 'focus',
    ];
    activityEvents.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      activityEvents.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [isAuthenticated]);

  const value: AuthContextType = {
    user,
    tokens,
    isLoading,
    isAuthenticated,
    signIn,
    signUp,
    signOut,
    confirmSignUp,
    resendSignUpCode,
    resetPassword,
    confirmResetPassword,
    updatePassword,
    updateProfile,
    refreshUser,
  };

  // Show loading screen while initializing
  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #007bff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }}></div>
          <p>Loading...</p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;