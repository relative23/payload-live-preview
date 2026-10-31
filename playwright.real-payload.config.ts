import { resolve } from 'node:path';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = process.env['CI'] === 'true';
/**
 * Which frontend the admin's Live Preview iframe points at: the static Astro
 * fixture (default), the SSR hybrid fixture (`PLP_REAL_PAYLOAD_TARGET=hybrid`,
 * fragment and route strategies against the real admin), or another framework's
 * example (`nextjs`, `sveltekit`, `nuxt`, `astro-session`) whose preview authorizes
 * the editor's real session, the plain HTML example (`html`), the Next.js example
 * framed from an admin that keeps its autoLogin (`nextjs-autologin`), or the SvelteKit
 * example's collection pages framed from an admin with three more collections (`create`).
 * `sveltekit3` and `sveltekit3-create` are those two SvelteKit targets on the SvelteKit 3 fixture,
 * `nuxt4` and `nuxt4-composable` the two Nuxt targets on the Nuxt 4 fixture.
 * `nextjs-production`, `sveltekit-production` and `nuxt-production` are the session targets
 * built for production and served behind TLS, with the admin behind an HTTPS front too.
 */
const requested = process.env['PLP_REAL_PAYLOAD_TARGET'] ?? 'astro';
/**
 * The frameworks whose example verifies the editor's real session
 * (`payload-session`) before it starts the runtime. None runs with
 * `NODE_ENV=production`: strict mode refuses an admin origin that is not HTTPS
 * only there, and this admin is plain HTTP on localhost. The Next.js, SvelteKit
 * and Nuxt examples run their dev server; Astro's built Node server qualifies
 * because nothing sets NODE_ENV (`astro dev` daemonizes in Astro 7, which
 * Playwright reads as a crash).
 */
interface Surface {
  readonly port: string;
  readonly directory: string;
  readonly command: string;
  /** The page of the example the admin frames; `/` unless the example has a page of its own. */
  readonly path?: string;
  /**
   * `hook`: a React hook or Vue composable page, tested by `surface-hook.spec.ts`.
   * `autologin`: the example's session check against an admin that keeps Payload's
   * autoLogin, tested by `surface-autologin.spec.ts`.
   * `create`: the create screen and the first save of a collection document, tested by
   * `surface-create.spec.ts` against an admin that has those collections.
   */
  readonly spec?: 'hook' | 'autologin' | 'create';
  /**
   * Built for production by `command` (a `scripts/*-production-fixture.mjs` launcher) and served
   * behind TLS on `port`; `prefix` names the launcher's variables (`<prefix>_ORIGIN`, …).
   */
  readonly production?: { readonly prefix: string };
}
const SESSION_SURFACES: Record<string, Surface> = {
  nextjs: { port: '4474', directory: 'nextjs-payload', command: 'npx next dev --port 4474' },
  sveltekit: { port: '4475', directory: 'sveltekit-payload', command: 'npx vite dev --port 4475' },
  sveltekit3: {
    port: '4475',
    directory: 'sveltekit3-payload',
    command: 'npx vite dev --port 4475',
  },
  nuxt: { port: '4476', directory: 'nuxt-payload', command: 'npx nuxt dev --port 4476' },
  nuxt4: { port: '4476', directory: 'nuxt4-payload', command: 'npx nuxt dev --port 4476' },
  // The Astro integration's middleware delivery under the strict default: the hook is
  // `payload-session`, in the module PLP_PAYLOAD_SERVER_URL makes astro.config.mjs name.
  'astro-session': {
    port: '4478',
    directory: 'astro-middleware',
    command: 'npm run build && HOST=127.0.0.1 PORT=4478 node ./dist/server/entry.mjs',
  },
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
  'nuxt4-composable': {
    port: '4476',
    directory: 'nuxt4-payload',
    command: 'npx nuxt dev --port 4476',
    path: '/composable',
    spec: 'hook',
  },
  // The Next.js example against an admin that keeps its autoLogin: nobody signs in and no
  // cookie exists, so the session check the example runs has nothing to forward.
  'nextjs-autologin': {
    port: '4474',
    directory: 'nextjs-payload',
    command: 'npx next dev --port 4474',
    spec: 'autologin',
  },
  // The SvelteKit example's `/mapped/<id>` and `/manual` pages, framed from an admin that has
  // the `mapped-pages`, `declined-pages` and `manual-pages` collections (PLP_REAL_PAYLOAD_COLLECTIONS).
  create: {
    port: '4475',
    directory: 'sveltekit-payload',
    command: 'npx vite dev --port 4475',
    spec: 'create',
  },
  'sveltekit3-create': {
    port: '4475',
    directory: 'sveltekit3-payload',
    command: 'npx vite dev --port 4475',
    spec: 'create',
  },
  // Strict mode accepts only https admin origins in production, so these run against the admin's
  // HTTPS front; the launchers build and start the example and put their own TLS front before it.
  'nextjs-production': {
    port: '4474',
    directory: 'nextjs-payload',
    command: 'node ../../scripts/next-production-fixture.mjs',
    production: { prefix: 'PLP_NEXT' },
  },
  'sveltekit-production': {
    port: '4475',
    directory: 'sveltekit-payload',
    command: 'node ../../scripts/sveltekit-production-fixture.mjs',
    production: { prefix: 'PLP_SVELTE' },
  },
  'nuxt-production': {
    port: '4476',
    directory: 'nuxt-payload',
    command: 'node ../../scripts/nuxt-production-fixture.mjs',
    production: { prefix: 'PLP_NUXT' },
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
const production = surface?.production;
const previewURL = `${production === undefined ? 'http' : 'https'}://localhost:${previewPort}`;
/** Where `next dev` serves the admin; a production target reaches it through an HTTPS front. */
const ADMIN_SERVER = 'http://localhost:3001';
/** The admin's own origin: the editor's browser opens it, and the preview site asks it who the editor is. */
const ADMIN = production === undefined ? ADMIN_SERVER : 'https://localhost:3443';
/**
 * The front's throw-away certificate, which the preview's server trusts through
 * NODE_EXTRA_CA_CERTS when it asks the admin who the editor is. Outside `outputDir`, which
 * Playwright empties before the run.
 */
const ADMIN_CERTIFICATE = 'test-results/real-payload-admin-front/certificate.pem';
/**
 * The session is real where the preview site verifies it. Payload's autoLogin
 * authenticates every request on the server and issues no cookie, so there the
 * test signs in through the login form and the preview receives `payload-token`.
 * The `autologin` surface is the one that keeps autoLogin on, to show that the
 * site then sees nobody.
 */
const session = SESSION_SURFACES[requested] !== undefined && surface?.spec !== 'autologin';
process.env['PLP_REAL_PAYLOAD_SESSION'] = session ? '1' : '';
process.env['PLP_REAL_PAYLOAD_PORT'] = previewPort;
process.env['PLP_REAL_PAYLOAD_SURFACE'] = target;
process.env['PLP_REAL_PAYLOAD_PATH'] = surface?.path ?? '/';
process.env['PLP_REAL_PAYLOAD_ADMIN_ORIGIN'] = ADMIN;
process.env['PLP_REAL_PAYLOAD_PREVIEW_ORIGIN'] = previewURL;
/** Browsers to run; the hybrid gate wants all three. */
const browsers = (process.env['PLP_REAL_PAYLOAD_BROWSERS'] ?? 'chromium').split(',');

/** One entry of `webServer`; Playwright does not export the type by name. */
type WebServer = Extract<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>[number];
/** The preview app the admin's Live Preview iframe points at. */
const previewServer: WebServer =
  target === 'hybrid'
    ? {
        command: `npm --prefix examples/astro-hybrid run build && HOST=127.0.0.1 PORT=${previewPort} node examples/astro-hybrid/dist/server/entry.mjs`,
        url: `${previewURL}/bench`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      }
    : surface !== undefined && production !== undefined
      ? {
          command: surface.command,
          cwd: `examples/${surface.directory}`,
          env: {
            PLP_PRODUCTION_ADMIN_ORIGIN: ADMIN,
            PLP_PAYLOAD_SERVER_URL: ADMIN,
            NODE_EXTRA_CA_CERTS: resolve(ADMIN_CERTIFICATE),
            [`${production.prefix}_ORIGIN`]: previewURL,
            // Below the ephemeral range (32768-60999), like the launchers' own defaults.
            [`${production.prefix}_INTERNAL_PORT`]: String(Number(previewPort) + 10_000),
          },
          url: `${previewURL}${surface.path ?? '/'}`,
          ignoreHTTPSErrors: true,
          reuseExistingServer: false,
          // The launcher builds the example first.
          timeout: 300_000,
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
          };
const adminServer: WebServer = {
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
    ...(surface?.spec === 'create' ? { PLP_REAL_PAYLOAD_COLLECTIONS: '1' } : {}),
  },
  url: `${ADMIN_SERVER}/admin`,
  reuseExistingServer: !isCI,
  // Payload + Next's first cold compile is slow.
  timeout: 180_000,
};
/**
 * The admin's HTTPS front for a production target. Playwright starts the servers in order, so
 * the certificate exists before the preview's server reads it.
 */
const adminFront: WebServer = {
  command: 'node scripts/admin-tls-front.mjs',
  env: {
    PLP_ADMIN_ORIGIN: ADMIN,
    PLP_ADMIN_INTERNAL_PORT: new URL(ADMIN_SERVER).port,
    PLP_ADMIN_CERTIFICATE: resolve(ADMIN_CERTIFICATE),
  },
  url: `${ADMIN}/admin`,
  ignoreHTTPSErrors: true,
  reuseExistingServer: false,
  timeout: 60_000,
};

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
          : surface.spec === 'autologin'
            ? /surface-autologin\.spec\.ts$/u
            : surface.spec === 'create'
              ? /surface-create\.spec\.ts$/u
              : session
                ? /surface-(?:smoke|session)\.spec\.ts$/u
                : /surface-smoke\.spec\.ts$/u,
  fullyParallel: false,
  // The admin runs `next dev`, and the first test of a job pays its cold compile of the admin
  // page and of the chunks the Live Preview toggle loads. On a loaded CI runner that took more
  // than the default 30 s in WebKit while the dev tools showed "Compiling" (run 41078740864, html);
  // the retry, warm, spent 4 s in its beforeEach. The budget covers the compile, not the tests.
  timeout: 60_000,
  forbidOnly: true,
  // A pass on retry must not hide nondeterminism in the release fixture.
  failOnFlakyTests: true,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [['github'], ['html'], ['./scripts/playwright-zero-skip-reporter.ts']]
    : [['list'], ['./scripts/playwright-zero-skip-reporter.ts']],
  use: {
    baseURL: ADMIN,
    ignoreHTTPSErrors: production !== undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ].filter((project) => browsers.includes(project.name)),
  webServer:
    production === undefined
      ? [previewServer, adminServer]
      : [adminServer, adminFront, previewServer],
};

export default defineConfig(config);
