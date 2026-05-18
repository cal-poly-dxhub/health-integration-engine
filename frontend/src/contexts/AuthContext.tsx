import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authService, type AuthUser, type AuthTokens } from '../services/auth';

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
    userRole?: string;
    organization?: string;
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
    userRole?: string;
    organization?: string;
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
      setIsLoading(true);
      const result = await authService.signIn({ email, password });
      
      setUser(result.user);
      setTokens(result.tokens);
      setIsAuthenticated(true);
    } catch (error) {
      setUser(null);
      setTokens(null);
      setIsAuthenticated(false);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Sign up
  const signUp = async (userData: {
    email: string;
    password: string;
    givenName?: string;
    familyName?: string;
    userRole?: string;
    organization?: string;
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
    userRole?: string;
    organization?: string;
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

  // Set up token refresh interval
  useEffect(() => {
    if (isAuthenticated && tokens) {
      // Refresh tokens every 45 minutes (tokens expire after 1 hour)
      const refreshInterval = setInterval(async () => {
        try {
          const newTokens = await authService.getTokens();
          setTokens(newTokens);
        } catch (error) {
          console.error('Token refresh failed:', error);
          // If token refresh fails, sign out user
          await signOut();
        }
      }, 45 * 60 * 1000); // 45 minutes

      return () => clearInterval(refreshInterval);
    }
  }, [isAuthenticated, tokens]);

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