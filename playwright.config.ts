import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = process.env['CI'] === 'true';
// Local override for the Astro fixture's port. `reuseExistingServer` reuses
// whatever answers on the URL, and on a shared machine that can be another
// project's dev server on 4173 — every spec then runs against a foreign page
// and fails with "preview frame missing". Unset, nothing changes; CI never
// sets it.
const astroPort = process.env['PLP_E2E_PORT'] ?? '4173';
/**
 * Which fixture servers to start, e.g. `PLP_E2E_SERVERS=astro` for a job that
 * installs only the Astro fixture (the Astro matrix). Default: all four.
 */
const servers = new Set(
  (
    process.env['PLP_E2E_SERVERS'] ??
    'astro,nextjs,sveltekit,nuxt,hybrid,pure-html,vanilla-client,astro-inline,astro-middleware'
  ).split(','),
);

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
    baseURL: `http://localhost:${astroPort}`,
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
      // The fixture's own `preview` script pins 4173, and a second `--port`
      // appended through npm does not reliably win. Invoke astro directly so
      // the port is stated exactly once.
      name: 'astro',
      command: `npm --prefix examples/astro-payload run build && cd examples/astro-payload && npx astro preview --host --port ${astroPort}`,
      // Suppress Astro's AI-agent auto-background mode. The environment
      // variable deliberately means "the caller handles backgrounding";
      // without `--background`, Astro therefore remains in the foreground.
      env: { ASTRO_PREVIEW_BACKGROUND: '1' },
      url: `http://localhost:${astroPort}/admin`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      name: 'nextjs',
      command: 'npm --prefix examples/nextjs-payload run dev',
      url: 'http://localhost:4174/admin.html',
      reuseExistingServer: !isCI,
      // Next's first dev compile is slow on cold caches.
      timeout: 120_000,
    },
    {
      name: 'sveltekit',
      command: 'npm --prefix examples/sveltekit-payload run dev',
      url: 'http://localhost:4175/admin.html',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      name: 'nuxt',
      command: 'npm --prefix examples/nuxt-payload run dev',
      url: 'http://localhost:4176/admin.html',
      reuseExistingServer: !isCI,
      // Nuxt compiles the Nitro server and the client bundle on first
      // request; a cold CI cache makes that as slow as Next's.
      timeout: 120_000,
    },
    {
      // The Astro adapter's middleware delivery (mode:'middleware'): SSR runtime
      // injection at request time via the integration-registered middleware,
      // gated on preview intent. Intent-only (defaults:'v1'); the authorized
      // paths are covered by SvelteKit and astro-hybrid.
      name: 'astro-middleware',
      command:
        'npm --prefix examples/astro-middleware run build && npm --prefix examples/astro-middleware run start',
      url: 'http://localhost:4183/?preview=true',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      // The Astro adapter's inline delivery (mode:'inline'): the runtime baked
      // into every page. astro-payload covers the loader branch; this is the
      // browser coverage for the inline branch, otherwise only unit-tested.
      name: 'astro-inline',
      command:
        'npm --prefix examples/astro-inline run build && cd examples/astro-inline && npx astro preview --host --port 4182',
      env: { ASTRO_PREVIEW_BACKGROUND: '1' },
      url: 'http://localhost:4182/admin/',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      // The npm-import path: a bundled SPA calling initLivePreview() from the
      // package's /client entry. Every JS-framework SPA (Remix, Solid, Vue,
      // Svelte, Qwik) reduces to this same call, so it stands in for all of them.
      name: 'vanilla-client',
      command: 'npm --prefix examples/vanilla-client run start',
      url: 'http://localhost:4181/admin.html',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      // Zero-framework baseline: a plain static HTML page carrying the inline
      // runtime baked by generateInlineScript(), served by a dependency-free
      // static server. If preview works here it works on any page that can
      // hold a <script> — the universal floor beneath every adapter.
      name: 'pure-html',
      command: 'npm --prefix examples/pure-html run start',
      url: 'http://localhost:4180/admin.html',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      name: 'hybrid',
      // The SSR fixture for the fragment strategy: built with the Node adapter
      // and served by its standalone entry, so the fragment endpoint renders.
      command:
        'npm --prefix examples/astro-hybrid run build && HOST=127.0.0.1 PORT=4177 node examples/astro-hybrid/dist/server/entry.mjs',
      url: 'http://localhost:4177/bench',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ].filter((server) => servers.has(server.name)),
};

if (isCI) {
  config.workers = 1;
}

export default defineConfig(config);
