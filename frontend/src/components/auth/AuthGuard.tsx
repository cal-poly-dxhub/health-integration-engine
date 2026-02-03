import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  requiredRole?: string;
  fallbackPath?: string;
}

/**
 * AuthGuard component to protect routes based on authentication status and user roles
 */
const AuthGuard: React.FC<AuthGuardProps> = ({
  children,
  requireAuth = true,
  requiredRole,
  fallbackPath = '/auth/signin',
}) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh' 
      }}>
        <div style={{ 
          width: '3rem', 
          height: '3rem', 
          border: '3px solid #e5e7eb', 
          borderTop: '3px solid #3b82f6', 
          borderRadius: '50%', 
          animation: 'spin 1s linear infinite' 
        }}></div>
      </div>
    );
  }

  // If authentication is required but user is not authenticated
  if (requireAuth && !isAuthenticated) {
    return (
      <Navigate
        to={fallbackPath}
        state={{ from: location.pathname }}
        replace
      />
    );
  }

  // If authentication is not required but user is authenticated (e.g., login page)
  if (!requireAuth && isAuthenticated) {
    const from = location.state?.from || '/dashboard';
    return <Navigate to={from} replace />;
  }

  // Check role-based access
  if (requiredRole && user) {
    const userRole = user.userRole || 'user';
    
    // Define role hierarchy
    const roleHierarchy: Record<string, number> = {
      user: 1,
      admin: 2,
      super_admin: 3,
    };

    const userRoleLevel = roleHierarchy[userRole] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

    if (userRoleLevel < requiredRoleLevel) {
      return (
        <Navigate
          to="/unauthorized"
          state={{ requiredRole, userRole }}
          replace
        />
      );
    }
  }

  return <>{children}</>;
};

/**
 * Higher-order component for protecting routes
 */
export const withAuthGuard = (
  Component: React.ComponentType<any>,
  options: Omit<AuthGuardProps, 'children'> = {}
) => {
  return (props: any) => (
    <AuthGuard {...options}>
      <Component {...props} />
    </AuthGuard>
  );
};

/**
 * Component for public routes (redirects to dashboard if authenticated)
 */
export const PublicRoute: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <AuthGuard requireAuth={false} fallbackPath="/dashboard">
      {children}
    </AuthGuard>
  );
};

/**
 * Component for protected routes (requires authentication)
 */
export const ProtectedRoute: React.FC<{
  children: ReactNode;
  requiredRole?: string;
}> = ({ children, requiredRole }) => {
  return (
    <AuthGuard requireAuth={true} requiredRole={requiredRole}>
      {children}
    </AuthGuard>
  );
};

/**
 * Component for admin-only routes
 */
export const AdminRoute: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <AuthGuard requireAuth={true} requiredRole="admin">
      {children}
    </AuthGuard>
  );
};

export default AuthGuard;