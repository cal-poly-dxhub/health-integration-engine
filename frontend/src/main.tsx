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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Pre-configure the auth service so it is ready before the first user interaction.
// AuthProvider also calls configure() — authService.configure() is idempotent (no-op if
// already configured), so calling it twice is safe.
(async () => {
  try {
    // Defer one tick so the polyfills above are fully applied before the
    // Cognito SDK (which reads globalThis.fetch at import time) loads.
    await new Promise(resolve => setTimeout(resolve, 0));
    const { authService } = await import('./services/auth');
    authService.configure({
      region: import.meta.env.VITE_AWS_REGION,
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
      identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID,
    });
  } catch (error) {
    console.error('Failed to pre-configure auth service:', error);
  }
})();
