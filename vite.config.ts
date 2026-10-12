import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The authoritative simulation service runs as a separate Python process. In local development
// the frontend talks to it directly on loopback; when the dev server is reached through a proxy
// or preview host the same-origin path below is forwarded to it.
const PYTHON_API_TARGET = process.env.NETSIM_API_TARGET ?? 'http://127.0.0.1:8765';

// Only the front-end sources should trigger a reload. Without this the watcher descends into the
// Python virtualenv (and the pytest/ruff caches), so installing a Python package or running the
// test suite reloads the page mid-edit.
const watchIgnored = [
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.pytest_cache/**',
  '**/.ruff_cache/**',
  '**/.git/**',
];

// The unit-test simulation double is aliased to an inert stub in every other build, so a
// browser bundle can never return fabricated simulation results.
const unitTestDouble = process.env.VITEST
  ? fileURLToPath(new URL('./src/lib/testDouble.ts', import.meta.url))
  : fileURLToPath(new URL('./src/lib/testDouble.stub.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      '@netsim/test-double': unitTestDouble,
    },
  },
  server: {
    host: true,
    port: 1420,
    strictPort: true,
    allowedHosts: true,
    watch: { ignored: watchIgnored },
    proxy: {
      '/netsim-api': {
        target: PYTHON_API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/netsim-api/, ''),
      },
    },
  },
  preview: {
    host: true,
    port: 1420,
    allowedHosts: true,
    watch: { ignored: watchIgnored },
    proxy: {
      '/netsim-api': {
        target: PYTHON_API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/netsim-api/, ''),
      },
    },
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
  },
  test: {
    exclude: ['**/e2e/**', '**/node_modules/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/testSetup.ts'],
  },
});
