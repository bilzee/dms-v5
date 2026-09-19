import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the E2E BASELINE suite (tests/e2e-baseline/**).
 *
 * Isolation contract — deliberately different from playwright.config.ts
 * (which runs the quarantined legacy corpus):
 * - Own port (3100) so a developer's dev server on :3000 is never reused.
 * - webServer env FORCES DATABASE_URL and a fixed JWT_SECRET, so the golden
 *   journeys run against a disposable test database. Setting E2E_DATABASE_URL
 *   targets the dedicated drms_e2e database (P10-5) so this suite can run
 *   concurrently with the Jest api suite on drms_test; unset falls back to
 *   drms_test (legacy sequential behavior — rollback-safe).
 * - globalSetup truncates the target database and seeds one user per role.
 * - Chromium only, generous timeouts: `next dev` compiles pages on demand.
 */
export default defineConfig({
  testDir: './tests/e2e-baseline',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './tests/e2e-baseline/global-setup.ts',
  webServer: {
    command: 'npx next dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        'postgresql://dms_dev:dev_password_change_in_prod@localhost:5435/drms_test?schema=public',
      JWT_SECRET: 'test-suite-jwt-secret',
      JWT_EXPIRES_IN: '24h',
      REDIS_ENABLED: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
