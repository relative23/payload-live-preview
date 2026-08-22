import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = process.env['CI'] === 'true';

const config: PlaywrightTestConfig = {
  testDir: './tests/e2e/specs',
  fullyParallel: true,
  forbidOnly: true,
  // Retries collect diagnostics, but a test that needed one is still a failed
  // quality signal. Keep this enabled locally too so ad-hoc retry runs agree.
  failOnFlakyTests: true,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['github'], ['html'], ['./scripts/playwright-zero-skip-reporter.ts']]
    : [['list'], ['./scripts/playwright-zero-skip-reporter.ts']],
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
      // Astro 7's development CLI may hand the server to a child process and
      // let the foreground process exit. Playwright treats that as a failed
      // managed server, so use the foreground preview server for a stable
      // process lifetime in local and CI runs.
      command:
        'npm --prefix examples/astro-payload run build && npm --prefix examples/astro-payload run preview',
      // Suppress Astro's AI-agent auto-background mode. The environment
      // variable deliberately means "the caller handles backgrounding";
      // without `--background`, Astro therefore remains in the foreground.
      env: { ASTRO_PREVIEW_BACKGROUND: '1' },
      url: 'http://localhost:4173/admin',
      reuseExistingServer: !isCI,
      timeout: 120_000,
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
    {
      command: 'npm --prefix examples/nuxt-payload run dev',
      url: 'http://localhost:4176/admin.html',
      reuseExistingServer: !isCI,
      // Nuxt compiles the Nitro server and the client bundle on first
      // request; a cold CI cache makes that as slow as Next's.
      timeout: 120_000,
    },
  ],
};

if (isCI) {
  config.workers = 1;
}

export default defineConfig(config);
