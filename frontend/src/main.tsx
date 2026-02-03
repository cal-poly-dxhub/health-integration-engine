import React from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary';
import App from './components/App';
import './index.css';

// Render app immediately with loading state
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Initialize smart auth service in background
const initializeAuth = async () => {
  try {
    // Wait for polyfills to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('Initializing auth service...');
    
    // Import auth service after polyfills are ready
    const { authService } = await import('./services/auth');
    
    authService.configure({
      region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_yVAz9QziX',
      userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || 'cj5mu2gksbdjjftoap4qc7tpf',
      identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID || 'us-east-1:174768ab-687d-4038-bd5e-d24bfbe86d8a',
    });
    console.log('Auth service configured successfully');
    
  } catch (error) {
    console.error('Failed to configure auth service:', error);
  }
};

// Initialize auth service
initializeAuth();