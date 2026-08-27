/**
 * The edge request/response path, executed rather than typed (roadmap 1.4.0).
 *
 * The built framework adapters are loaded as ES modules into a `node:vm`
 * context whose globals are the Web platform's and nothing else — no
 * `process`, no `Buffer`, no `require`, no `node:` modules — and driven
 * through a preview request the way an edge runtime would drive them. The
 * Node path is the unit and integration suites on Node 20–26; this is the
 * other one.
 *
 * Runs after the build: `npm run test:edge` (needs `--experimental-vm-modules`,
 * which the npm script sets).
 *
 * @module scripts/check-edge-runtime
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'https://admin.example.com';
const INTENT = 'https://site.example.com/page?preview=true';
const PAGE = '<html><head></head><body>hi</body></html>';

/** Exactly what an edge runtime exposes; anything else is a failure to be found here. */
function edgeGlobals(): Record<string, unknown> {
  return {
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto,
    btoa,
    atob,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
    AbortController,
    AbortSignal,
    fetch: () => Promise.reject(new Error('edge check: unexpected fetch')),
  };
}

type Exports = Record<string, unknown>;

async function loadModule(context: vm.Context, file: string): Promise<Exports> {
  const source = await readFile(resolve(ROOT, file), 'utf8');
  const identifier = pathToFileURL(resolve(ROOT, file)).href;
  const module = new vm.SourceTextModule(source, { context, identifier });
  await module.link((specifier: string) => {
    throw new Error(
      `edge check: ${file} imports "${specifier}" — an edge bundle must be self-contained`,
    );
  });
  await module.evaluate();
  return module.namespace as Exports;
}

const html = () => new Response(PAGE, { headers: { 'content-type': 'text/html' } });

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

interface Case {
  readonly name: string;
  readonly run: () => Promise<void>;
}

async function main(): Promise<void> {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('edge check needs node --experimental-vm-modules');
  }
  const context = vm.createContext(edgeGlobals());
  const nextjs = await loadModule(context, 'dist/adapters/nextjs/index.js');
  const sveltekit = await loadModule(context, 'dist/adapters/sveltekit/index.js');
  const astro = await loadModule(context, 'dist/adapters/astro/index.js');
  const nuxt = await loadModule(context, 'dist/adapters/nuxt/index.js');
  const server = await loadModule(context, 'dist/server.js');

  const cases: readonly Case[] = [
    {
      name: 'Next.js middleware injects into a Response for a preview request and leaves others alone',
      run: async () => {
        const create = nextjs['createLivePreviewMiddleware'] as (
          o: unknown,
        ) => (r: Request, x: Response) => Promise<Response>;
        const middleware = create({ allowedOrigins: [ADMIN] });
        const injected = await middleware(new Request(INTENT), html());
        check((await injected.text()).includes('__LIVE_PREVIEW_CONFIG__'), 'Next.js: no injection');
        check(
          (injected.headers.get('content-security-policy') ?? '').includes('frame-ancestors'),
          'Next.js: no CSP',
        );
        const untouched = await middleware(new Request('https://site.example.com/'), html());
        check((await untouched.text()) === PAGE, 'Next.js: touched a non-preview response');
      },
    },
    {
      name: 'SvelteKit handle injects through transformPageChunk and writes the nonce to locals',
      run: async () => {
        const create = sveltekit['livePreviewHandle'] as (
          o: unknown,
        ) => (i: unknown) => Promise<Response>;
        const handle = create({ allowedOrigins: [ADMIN] });
        const locals: Record<string, unknown> = {};
        const resolve = (
          _event: unknown,
          opts: {
            transformPageChunk?: (c: { html: string; done: boolean }) => string | undefined;
          } = {},
        ) =>
          Promise.resolve(
            new Response(opts.transformPageChunk?.({ html: PAGE, done: true }) ?? PAGE, {
              headers: { 'content-type': 'text/html' },
            }),
          );
        const response = await handle({ event: { request: new Request(INTENT), locals }, resolve });
        check(
          (await response.text()).includes('__LIVE_PREVIEW_CONFIG__'),
          'SvelteKit: no injection',
        );
        check(typeof locals['livePreviewNonce'] === 'string', 'SvelteKit: no nonce in locals');
      },
    },
    {
      name: 'Astro middleware injects and hands the nonce to locals',
      run: async () => {
        const create = astro['createLivePreviewMiddleware'] as (
          o: unknown,
        ) => (c: unknown, n: () => Promise<Response>) => Promise<Response>;
        const middleware = create({ allowedOrigins: [ADMIN] });
        const locals: Record<string, unknown> = {};
        const response = await middleware({ request: new Request(INTENT), locals }, () =>
          Promise.resolve(html()),
        );
        check((await response.text()).includes('__LIVE_PREVIEW_CONFIG__'), 'Astro: no injection');
        check(typeof locals['livePreviewNonce'] === 'string', 'Astro: no nonce in locals');
      },
    },
    {
      name: 'Nuxt Nitro plugin injects into render:html head',
      run: async () => {
        const plugin = nuxt['livePreviewNitroPlugin'] as (o: unknown) => (nitro: unknown) => void;
        let hook:
          ((h: { head: string[] }, c: { event: unknown }) => void | Promise<void>) | undefined;
        plugin({ allowedOrigins: [ADMIN] })({
          hooks: {
            hook(_name: string, fn: NonNullable<typeof hook>) {
              hook = fn;
            },
          },
        });
        check(hook !== undefined, 'Nuxt: render:html hook not registered');
        const headers: Record<string, string> = {};
        const event = {
          path: '/page?preview=true',
          context: {},
          node: {
            req: { url: '/page?preview=true', headers: { host: 'site.example.com' } },
            res: {
              getHeader: (n: string) => headers[n.toLowerCase()],
              setHeader: (n: string, v: string) => {
                headers[n.toLowerCase()] = v;
              },
            },
          },
        };
        const head: string[] = [];
        await hook?.({ head }, { event });
        check(head.join('').includes('__LIVE_PREVIEW_CONFIG__'), 'Nuxt: no injection');
      },
    },
    {
      name: 'server: a signed preview token round-trips on Web Crypto alone',
      run: async () => {
        const issue = server['issuePreviewToken'] as (c: unknown, o: unknown) => Promise<string>;
        const authorize = server['authorizePreviewRequest'] as (
          r: Request,
          s: unknown,
        ) => Promise<{ authorized: boolean }>;
        const secret = 'edge-secret-'.repeat(4);
        const audience = 'https://site.example.com';
        const token = await issue({ audience, path: '/page' }, { secret });
        const ok = await authorize(new Request(`${INTENT}&previewToken=${token}`), {
          type: 'signed-token',
          secret,
          audience,
        });
        check(ok.authorized, `server: valid token refused: ${JSON.stringify(ok)}`);
        const bad = await authorize(new Request(`${INTENT}&previewToken=${token}x`), {
          type: 'signed-token',
          secret,
          audience,
        });
        check(!bad.authorized, 'server: tampered token accepted');
      },
    },
  ];

  const failures: string[] = [];
  for (const item of cases) {
    try {
      await item.run();
      console.log(`PASS edge: ${item.name}`);
    } catch (error) {
      failures.push(item.name);
      console.error(
        `FAIL edge: ${item.name} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`edge runtime gate failed for ${String(failures.length)} case(s)`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
