// Simplified polyfills for S3/CloudFront compatibility
// This file must be imported before any other modules that use fetch

// Ensure global is available
if (typeof global === 'undefined') {
  (window as any).global = window;
}