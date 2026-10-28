import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * The suite is a full-stack end-to-end test: it starts the authoritative Python simulation
 * service and the Vite dev server, and the browser talks to the service through the frontend
 * (no mocks, no stub backend).
 *
 *   npx playwright install chromium     # one-off browser download
 *   npx playwright test                 # runs everything below
 *
 * `webServer` starts both processes (reusing any that are already listening locally, which
 * keeps the suite usable next to a running dev server) and tears them down again in CI.
 */
const API_PORT = Number(process.env.NETSIM_API_PORT ?? 8765);
const WEB_PORT = Number(process.env.NETSIM_WEB_PORT ?? 1420);
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Point Playwright at a specific Chromium build when the bundled one is unavailable
        // (for example a container image with no browser download access):
        //   NETSIM_CHROMIUM_PATH=/path/to/chromium npx playwright test
        launchOptions: process.env.NETSIM_CHROMIUM_PATH
          ? {
              executablePath: process.env.NETSIM_CHROMIUM_PATH,
              args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: `python3 python/netsim/server.py ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        // The dev server proxies /netsim-api to the Python service via NETSIM_API_TARGET. Do NOT
        // set VITE_NETSIM_API_URL here: when it is set, the browser client uses only the direct
        // endpoint and the same-origin /netsim-api fallback (e2e test 2b) is never exercised.
        // Without it the client's candidate list is [loopback, /netsim-api] and the harness
        // exercises both resolution paths against the same authoritative service.
        NETSIM_API_TARGET: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
