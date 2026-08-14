import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = process.env['CI'] === 'true';
const requestedDuration = Number.parseInt(process.env['PLP_SOAK_DURATION_MS'] ?? '', 10);
const durationMs =
  Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : 0;

const config: PlaywrightTestConfig = {
  testDir: './tests/soak',
  fullyParallel: false,
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  workers: 1,
  timeout: Math.max(180_000, durationMs + 180_000),
  reporter: isCI
    ? [
        ['github'],
        ['json', { outputFile: 'test-results/soak-results.json' }],
        ['./scripts/playwright-zero-skip-reporter.ts'],
      ]
    : [['list'], ['./scripts/playwright-zero-skip-reporter.ts']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-soak', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'npm --prefix examples/astro-payload run build && npm --prefix examples/astro-payload run preview',
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
    url: 'http://localhost:4173/admin',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
};

export default defineConfig(config);
