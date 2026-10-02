import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = process.env['CI'] === 'true';
/**
 * Which frontend the admin's Live Preview iframe points at: the static Astro
 * fixture (default), the SSR hybrid fixture (`PLP_REAL_PAYLOAD_TARGET=hybrid`,
 * fragment and route strategies against the real admin), or another framework's
 * example (`nextjs`, `sveltekit`, `nuxt`) whose preview authorizes the editor's
 * real session, or the plain HTML example (`html`).
 */
const requested = process.env['PLP_REAL_PAYLOAD_TARGET'] ?? 'astro';
/**
 * The frameworks whose example verifies the editor's real session
 * (`payload-session`) before it starts the runtime. Each runs its dev server:
 * a production build refuses an admin origin that is not HTTPS, and this admin
 * is plain HTTP on localhost.
 */
interface Surface {
  readonly port: string;
  readonly directory: string;
  readonly command: string;
  /** The page of the example the admin frames; `/` unless the example has a page of its own. */
  readonly path?: string;
  /** `hook`: a React hook or Vue composable page, tested by `surface-hook.spec.ts`. */
  readonly spec?: 'hook';
}
const SESSION_SURFACES: Record<string, Surface> = {
  nextjs: { port: '4474', directory: 'nextjs-payload', command: 'npx next dev --port 4474' },
  sveltekit: { port: '4475', directory: 'sveltekit-payload', command: 'npx vite dev --port 4475' },
  nuxt: { port: '4476', directory: 'nuxt-payload', command: 'npx nuxt dev --port 4476' },
  // The React hook and the Vue composable: pages of the same examples that render
  // from the merged document instead of from bindings the DOM runtime patches.
  'nextjs-hook': {
    port: '4474',
    directory: 'nextjs-payload',
    command: 'npx next dev --port 4474',
    path: '/hook',
    spec: 'hook',
  },
  'nuxt-composable': {
    port: '4476',
    directory: 'nuxt-payload',
    command: 'npx nuxt dev --port 4476',
    path: '/composable',
    spec: 'hook',
  },
};
/** A plain HTML page has no request time: the runtime is baked in and the origin rule is its gate. */
const STATIC_SURFACES: Record<string, Surface> = {
  html: {
    port: '4477',
    directory: 'pure-html',
    command: 'node build.mjs && PORT=4477 node serve.mjs',
  },
};
const surface = SESSION_SURFACES[requested] ?? STATIC_SURFACES[requested];
const target = requested === 'hybrid' || surface !== undefined ? requested : 'astro';
/** The Astro preview app's port; the admin's Live Preview iframe is pointed at it. */
const ports: Record<string, string> = { astro: '4173', hybrid: '4177' };
const previewPort = process.env['PLP_E2E_PORT'] ?? surface?.port ?? ports[target] ?? '4173';
const previewURL = `http://localhost:${previewPort}`;
/** The admin's own origin: the preview site asks it who the editor is. */
const ADMIN = 'http://localhost:3001';
/**
 * The session is real where the preview site verifies it. Payload's autoLogin
 * authenticates every request on the server and issues no cookie, so there the
 * test signs in through the login form and the preview receives `payload-token`.
 */
const session = SESSION_SURFACES[requested] !== undefined;
process.env['PLP_REAL_PAYLOAD_SESSION'] = session ? '1' : '';
process.env['PLP_REAL_PAYLOAD_PORT'] = previewPort;
process.env['PLP_REAL_PAYLOAD_SURFACE'] = target;
process.env['PLP_REAL_PAYLOAD_PATH'] = surface?.path ?? '/';
/** Browsers to run; the hybrid gate wants all three. */
const browsers = (process.env['PLP_REAL_PAYLOAD_BROWSERS'] ?? 'chromium').split(',');

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
 * The admin's `payload.config.ts` auto-logs-in a seeded editor and rewrites
 * the homepage's title, subtitle and tags on every boot, so runs start from the
 * same text.
 */
const config: PlaywrightTestConfig = {
  testDir: './tests/real-payload',
  // Playwright empties its output directory before every run, and by default
  // that directory is test-results/ — where Stryker, the soak and the bench
  // also write their reports. An E2E run after a mutation run deleted the
  // mutation report before anyone read it. Each Playwright config now empties
  // only its own subfolder. CI is unaffected: those jobs run on separate
  // runners and upload playwright-report/.
  outputDir: 'test-results/playwright-real-payload',
  testMatch:
    target === 'hybrid'
      ? /hybrid-.*\.spec\.ts$/u
      : surface === undefined
        ? /^(?!.*(?:hybrid|surface)-).*\.spec\.ts$/u
        : surface.spec === 'hook'
          ? /surface-hook\.spec\.ts$/u
          : session
            ? /surface-(?:smoke|session)\.spec\.ts$/u
            : /surface-smoke\.spec\.ts$/u,
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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ].filter((project) => browsers.includes(project.name)),
  webServer: [
    target === 'hybrid'
      ? {
          command: `npm --prefix examples/astro-hybrid run build && HOST=127.0.0.1 PORT=${previewPort} node examples/astro-hybrid/dist/server/entry.mjs`,
          url: `${previewURL}/bench`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        }
      : surface !== undefined
        ? {
            command: surface.command,
            cwd: `examples/${surface.directory}`,
            env: { PAYLOAD_ADMIN_ORIGIN: ADMIN, PLP_PAYLOAD_SERVER_URL: ADMIN },
            url: `${previewURL}${surface.path ?? '/'}`,
            reuseExistingServer: !isCI,
            timeout: 180_000,
          }
        : {
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
      env: {
        FRONTEND_URL: previewURL,
        ...(session
          ? {
              PLP_REAL_PAYLOAD_LOGIN: '1',
              PLP_REAL_PAYLOAD_PATH: surface?.path ?? '/',
              PLP_REAL_PAYLOAD_ORIGINS: previewURL,
            }
          : {}),
      },
      url: `${ADMIN}/admin`,
      reuseExistingServer: !isCI,
      // Payload + Next's first cold compile is slow.
      timeout: 180_000,
    },
  ],
};

export default defineConfig(config);
