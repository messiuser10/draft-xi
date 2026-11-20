/**
 * Playwright smoke test (spec M7): builds the web app, starts the production server on a throwaway
 * SQLite file with instant bots, then drives a whole game in Chromium. Run with `npm run test:e2e`.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'rm -f var/e2e.db var/e2e.db-* && npm run build && npm start',
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: 'file:var/e2e.db',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      COOKIE_SECURE: 'false',
      BOT_PICK_DELAY_MS: '0',
      START_COUNTDOWN_SECONDS: '0',
    },
  },
});
