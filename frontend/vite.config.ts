import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // Disable sourcemaps for production to reduce bundle size
    assetsDir: 'assets',
    // Optimize for Amplify deployment
    target: 'es2015', // Ensure compatibility with older browsers
    minify: 'terser',
    cssMinify: true,
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and performance
        manualChunks: {
          // Vendor chunk for third-party libraries
          vendor: [
            'react',
            'react-dom',
            'react-router-dom',
            'react-redux',
            '@reduxjs/toolkit'
          ],
          // AWS SDK chunk (large library)
          aws: [
            '@aws-sdk/client-cognito-identity-provider',
            '@aws-sdk/credential-providers'
          ],
          // UI libraries chunk
          ui: [
            'react-dnd',
            'react-dnd-html5-backend',
            '@monaco-editor/react'
          ]
        },
        // Ensure proper file extensions for Amplify MIME type detection
        assetFileNames: (assetInfo: any) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return `assets/images/[name]-[hash][extname]`;
          }
          if (/woff2?|eot|ttf|otf/i.test(ext)) {
            return `assets/fonts/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  },
    resolve: {
      alias: {
        '@': '/src'
      }
    },
    define: {
      global: 'globalThis',
      'process.env': {},
      // Ensure Request is available globally for AWS SDK
      'typeof Request': '"function"',
    },
  optimizeDeps: {
    include: [
      '@aws-sdk/client-cognito-identity-provider',
      'react',
      'react-dom',
      'react-router-dom'
    ],
    exclude: ['whatwg-fetch']
  },
  // Ensure proper handling of environment variables for Amplify
  envPrefix: ['VITE_', 'REACT_APP_']
})