import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = process.env['CI'] === 'true';

const config: PlaywrightTestConfig = {
  testDir: './tests/e2e/specs',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // Drive the Astro example app — it doubles as the demo and the E2E
    // fixture, so the test environment is identical to what consumers
    // experience locally.
    command: 'npm --prefix examples/astro-payload run dev',
    url: 'http://localhost:4173/admin',
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
};

if (isCI) {
  config.workers = 1;
}

export default defineConfig(config);
