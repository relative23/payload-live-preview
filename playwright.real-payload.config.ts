import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = process.env['CI'] === 'true';
/** The Astro preview app's port; the admin's Live Preview iframe is pointed at it. */
const previewPort = process.env['PLP_E2E_PORT'] ?? '4173';
const previewURL = `http://localhost:${previewPort}`;

/**
 * Dedicated config for the full-chain E2E against a REAL Payload server.
 *
 * This is kept separate from `playwright.config.ts` because it boots a
 * heavyweight fixture — an actual Payload 3.x + Next.js admin
 * (`examples/payload-backend`) plus the Astro preview app — which is far
 * slower to start than the mock-admin suites. Run it with
 * `npm run test:e2e:real-payload`.
 *
 * Two web servers come up together:
 *   - the Astro preview app on :4173 (hosts our injected runtime), and
 *   - the Payload admin on :3001 (points its Live Preview iframe at :4173).
 *
 * The admin's `payload.config.ts` auto-logs-in a seeded editor and resets
 * the homepage global on every boot, so runs are deterministic.
 */
const config: PlaywrightTestConfig = {
  testDir: './tests/real-payload',
  fullyParallel: false,
  forbidOnly: true,
  // A pass on retry must not hide nondeterminism in the release fixture.
  failOnFlakyTests: true,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [['github'], ['html'], ['./scripts/playwright-zero-skip-reporter.ts']]
    : [['list'], ['./scripts/playwright-zero-skip-reporter.ts']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Astro 7's `astro dev` daemonizes (the foreground CLI exits after
      // spawning a background server), which Playwright reads as a
      // web-server crash. `astro preview` on a static build stays in the
      // foreground and serves the same runtime-injected HTML, so it's the
      // reliable choice for a managed web server.
      command: `npm --prefix examples/astro-payload run build && cd examples/astro-payload && npx astro preview --host --port ${previewPort}`,
      // Suppress Astro's AI-agent auto-background mode so Playwright owns the
      // foreground process and can reliably observe and terminate it.
      env: { ASTRO_PREVIEW_BACKGROUND: '1' },
      url: `${previewURL}/`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      // `e2e:serve` regenerates the admin import map before booting so a
      // fresh checkout (where importMap.js is gitignored) still works.
      command: 'npm --prefix examples/payload-backend run e2e:serve',
      env: { FRONTEND_URL: previewURL },
      url: 'http://localhost:3001/admin',
      reuseExistingServer: !isCI,
      // Payload + Next's first cold compile is slow.
      timeout: 180_000,
    },
  ],
};

export default defineConfig(config);
