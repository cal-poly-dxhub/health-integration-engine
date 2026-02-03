import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { authService } from '../services/auth';
import Dashboard from './Dashboard';
import WorkflowCanvas from './workflow/WorkflowCanvas';
import WorkflowDetails from './workflow/WorkflowDetails';
import SignIn from './auth/SignIn';
import SignUp from './auth/SignUp';
import ConfirmSignUp from './auth/ConfirmSignUp';
import ForgotPassword from './auth/ForgotPassword';
import './Dashboard.css';

// Auth configuration from environment variables with fallbacks for local development
const authConfig = {
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_yVAz9QziX',
  userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || 'cj5mu2gksbdjjftoap4qc7tpf',
  identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID || 'us-east-1:174768ab-687d-4038-bd5e-d24bfbe86d8a',
};

// Wrapper component to read email from URL params
function ConfirmSignUpWrapper() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  
  return (
    <ConfirmSignUp 
      email={email}
      onConfirmSuccess={() => window.location.href = '/signin'}
      onBackToSignUp={() => window.location.href = '/signup'}
    />
  );
}

// Protected Route component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/signin" replace />;
}

// Public Route component (redirects to dashboard if authenticated)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <>{children}</>;
}

// App Routes component (needs to be inside AuthProvider)
function AppRoutes() {
  return (
    <Router>
      <div className="app">
        <Routes>
          {/* Auth routes */}
          <Route path="/signin" element={
            <PublicRoute>
              <SignIn 
                onSignInSuccess={() => window.location.href = '/dashboard'}
                onSwitchToSignUp={() => window.location.href = '/signup'}
                onSwitchToForgotPassword={() => window.location.href = '/forgot-password'}
              />
            </PublicRoute>
          } />
          <Route path="/signup" element={
            <PublicRoute>
              <SignUp 
                onSignUpSuccess={(email) => window.location.href = `/confirm-signup?email=${encodeURIComponent(email)}`}
                onSwitchToSignIn={() => window.location.href = '/signin'}
              />
            </PublicRoute>
          } />
          <Route path="/confirm-signup" element={
            <PublicRoute>
              <ConfirmSignUpWrapper />
            </PublicRoute>
          } />
          <Route path="/forgot-password" element={
            <PublicRoute>
              <ForgotPassword 
                onBackToSignIn={() => window.location.href = '/signin'}
              />
            </PublicRoute>
          } />
          
          {/* Protected routes */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard 
                onSignOut={async () => {
                  try {
                    await authService.signOut();
                    window.location.href = '/signin';
                  } catch (error) {
                    console.error('Sign out error:', error);
                    // Force redirect even if sign out fails
                    window.location.href = '/signin';
                  }
                }}
                onEditWorkflow={(workflowId) => window.location.href = `/workflow/editor/${workflowId}`}
                onViewWorkflow={(workflowId) => window.location.href = `/workflow/${workflowId}`}
              />
            </ProtectedRoute>
          } />
          <Route path="/workflow/:workflowId" element={
            <ProtectedRoute>
              <WorkflowDetails />
            </ProtectedRoute>
          } />
          <Route path="/workflow/editor/:workflowId" element={
            <ProtectedRoute>
              <WorkflowCanvas />
            </ProtectedRoute>
          } />
          
          {/* Default redirects */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default function App() {
  return (
    <AuthProvider config={authConfig}>
      <AppRoutes />
    </AuthProvider>
  );
}