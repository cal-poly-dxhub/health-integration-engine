import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill'
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill'

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
    target: 'es2015',
    minify: 'terser',
    cssMinify: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
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
        '@': '/src',
        buffer: 'buffer',
        process: 'process/browser',
        stream: 'stream-browserify',
        util: 'util'
      }
    },
    define: {
      global: 'globalThis',
    },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true,
          process: true
        }),
        NodeModulesPolyfillPlugin()
      ]
    },
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@aws-sdk/client-cognito-identity-provider'
    ]
  },
  // Ensure proper handling of environment variables for Amplify
  envPrefix: ['VITE_', 'REACT_APP_']
})