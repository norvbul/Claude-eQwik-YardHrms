import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end tests drive the real React apps against the real API and MySQL database.
 * Start the stack first (`docker compose up` or the dev commands in README), then run `pnpm test:e2e`.
 * Set E2E_START_SERVERS=true to let Playwright start the API and both web apps itself.
 */
const root = path.resolve(__dirname, '../..');
const start = process.env.E2E_START_SERVERS === 'true';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts$/,
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(root, 'playwright-report') }]],
  outputDir: path.join(root, 'test-results'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  webServer: start
    ? [
        { command: 'node apps/api/dist/main.js', cwd: root, url: 'http://127.0.0.1:3000/api/v1/health', reuseExistingServer: true, timeout: 60_000 },
        { command: 'pnpm --filter @yardhrms/hrms-web exec vite --host 127.0.0.1', cwd: root, url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
        { command: 'pnpm --filter @yardhrms/license-admin-web exec vite --host 127.0.0.1', cwd: root, url: 'http://127.0.0.1:5174', reuseExistingServer: true, timeout: 60_000 },
      ]
    : undefined,
});
