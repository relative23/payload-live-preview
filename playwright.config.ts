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
  webServer: [
    // The example apps double as demos and E2E fixtures, so the test
    // environment is identical to what consumers experience locally.
    {
      command: 'npm --prefix examples/astro-payload run dev',
      url: 'http://localhost:4173/admin',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: 'npm --prefix examples/nextjs-payload run dev',
      url: 'http://localhost:4174/admin.html',
      reuseExistingServer: !isCI,
      // Next's first dev compile is slow on cold caches.
      timeout: 120_000,
    },
    {
      command: 'npm --prefix examples/sveltekit-payload run dev',
      url: 'http://localhost:4175/admin.html',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
};

if (isCI) {
  config.workers = 1;
}

export default defineConfig(config);
