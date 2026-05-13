// Polyfill for AWS SDK v3 - must be before any imports
if (typeof global === 'undefined') {
  (window as any).global = window;
}
if (typeof process === 'undefined') {
  (window as any).process = { env: {} };
}
// Ensure fetch globals are available for AWS SDK v3
if (typeof globalThis.Request === 'undefined') {
  globalThis.Request = window.Request;
  globalThis.Response = window.Response;
  globalThis.Headers = window.Headers;
  globalThis.fetch = window.fetch;
}

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
      region: import.meta.env.VITE_AWS_REGION,
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
      identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID,
    });
    console.log('Auth service configured successfully');
    
  } catch (error) {
    console.error('Failed to configure auth service:', error);
  }
};

// Initialize auth service
initializeAuth();