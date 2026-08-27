import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Real-browser update-to-paint benchmark.
 *
 * A separate config, not a project in the e2e matrix, because this is a
 * scheduled trend rather than a pull-request gate: browser timing on a shared
 * runner is noise, and the roadmap's own rule is that microbenchmark noise is
 * a trend signal while deterministic budgets are the hard gates. The spec
 * reports each scenario against its stated budget; it fails only when a
 * measurement could not be taken at all.
 *
 * Chromium only. The soak already established that heap measurement needs
 * CDP; timing does not, but one engine keeps the trend comparable with
 * itself, which is the whole point of a trend.
 */

const isCI = process.env['CI'] === 'true';
const astroPort = process.env['PLP_E2E_PORT'] ?? '4173';

const config: PlaywrightTestConfig = {
  testDir: './tests/browser-bench',
  fullyParallel: false,
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  workers: 1,
  timeout: 300_000,
  reporter: isCI
    ? [
        ['github'],
        ['json', { outputFile: 'test-results/browser-bench-results.json' }],
        ['./scripts/playwright-zero-skip-reporter.ts'],
      ]
    : [['list'], ['./scripts/playwright-zero-skip-reporter.ts']],
  use: {
    baseURL: `http://localhost:${astroPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-bench', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm --prefix examples/astro-payload run build && cd examples/astro-payload && npx astro preview --host --port ${astroPort}`,
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
    url: `http://localhost:${astroPort}/bench`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
};

export default defineConfig(config);
