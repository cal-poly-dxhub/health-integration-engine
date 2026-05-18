import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import Dashboard from './Dashboard';
import WorkflowCanvas from './workflow/WorkflowCanvas';
import WorkflowDetails from './workflow/WorkflowDetails';
import SignIn from './auth/SignIn';
import SignUp from './auth/SignUp';
import ConfirmSignUp from './auth/ConfirmSignUp';
import ForgotPassword from './auth/ForgotPassword';

const authConfig = {
  region: import.meta.env.VITE_AWS_REGION,
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
  identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID,
};

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

function SignInPage() {
  const navigate = useNavigate();
  return (
    <PublicRoute>
      <SignIn
        onSignInSuccess={() => navigate('/dashboard', { replace: true })}
        onSwitchToSignUp={() => navigate('/signup')}
        onSwitchToForgotPassword={() => navigate('/forgot-password')}
      />
    </PublicRoute>
  );
}

function SignUpPage() {
  const navigate = useNavigate();
  return (
    <PublicRoute>
      <SignUp
        onSignUpSuccess={(email, password) =>
          navigate(`/confirm-signup?email=${encodeURIComponent(email)}`, {
            state: { password },
          })
        }
        onSwitchToSignIn={() => navigate('/signin')}
      />
    </PublicRoute>
  );
}

function ConfirmSignUpPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  // Password passed via router location state — never exposed in the URL
  const password = (window.history.state?.usr as { password?: string } | undefined)?.password;
  return (
    <PublicRoute>
      <ConfirmSignUp
        email={email}
        password={password}
        onConfirmSuccess={() => navigate('/dashboard', { replace: true })}
        onBackToSignUp={() => navigate('/signup')}
      />
    </PublicRoute>
  );
}

function ForgotPasswordPage() {
  const navigate = useNavigate();
  return (
    <PublicRoute>
      <ForgotPassword onBackToSignIn={() => navigate('/signin')} />
    </PublicRoute>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  return (
    <ProtectedRoute>
      <Dashboard
        onSignOut={async () => {
          // Navigate first so ProtectedRoute never renders the unauthenticated flash
          navigate('/signin', { replace: true });
          try {
            await signOut();
          } catch (error) {
            console.error('Sign out error:', error);
          }
        }}
        onEditWorkflow={(workflowId) => navigate(`/workflow/editor/${workflowId}`)}
        onViewWorkflow={(workflowId) => navigate(`/workflow/${workflowId}`)}
      />
    </ProtectedRoute>
  );
}

function AppRoutes() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/confirm-signup" element={<ConfirmSignUpPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workflow/:workflowId" element={
            <ProtectedRoute><WorkflowDetails /></ProtectedRoute>
          } />
          <Route path="/workflow/editor/:workflowId" element={
            <ProtectedRoute><WorkflowCanvas /></ProtectedRoute>
          } />
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
