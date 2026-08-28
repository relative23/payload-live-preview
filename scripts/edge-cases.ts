/**
 * What each adapter must do inside an edge runtime, driven through the shape a
 * real preset hands it. The v2 rows repeat every adapter under the 2.0 strict
 * defaults, where injection is gated on a verified context rather than intent.
 */

import { check, type Exports, type EdgeCase } from './edge-harness';

const ADMIN = 'https://admin.example.com';
const INTENT = 'https://site.example.com/page?preview=true';
const PAGE = '<html><head></head><body>hi</body></html>';
const SECRET = 'edge-secret-'.repeat(4);
const AUDIENCE = 'https://site.example.com';

export interface EdgeModules {
  readonly nextjs: Exports;
  readonly sveltekit: Exports;
  readonly astro: Exports;
  readonly nuxt: Exports;
  readonly server: Exports;
  readonly fragment: Exports;
  readonly payload: Exports;
}

interface Authorization {
  readonly authorized: boolean;
}
type Authorize = (request: Request, strategy: unknown) => Promise<Authorization>;
type IssueToken = (claims: unknown, options: unknown) => Promise<string>;

const html = (): Response => new Response(PAGE, { headers: { 'content-type': 'text/html' } });

const injected = (text: string): boolean => text.includes('__LIVE_PREVIEW_CONFIG__');

function hasFrameAncestors(headers: { get(name: string): string | null | undefined }): boolean {
  return (headers.get('content-security-policy') ?? '').includes('frame-ancestors');
}

/**
 * Strict options that pass the constructor gate: an https admin origin and a
 * real `authorizePreview`, wired to the shipped signed-token verifier so the
 * v2 path is exercised end to end rather than through a stub verdict.
 */
function strictOptions(server: Exports): Record<string, unknown> {
  const authorize = server['authorizePreviewRequest'] as Authorize;
  return {
    defaults: 'v2',
    allowedOrigins: [ADMIN],
    authorizePreview: (request: Request) =>
      authorize(request, { type: 'signed-token', secret: SECRET, audience: AUDIENCE }),
  };
}

function authorizedRequest(token: string): Request {
  return new Request(`${INTENT}&previewToken=${token}`);
}

/** An h3 v2 event: a web `Request` and a `Headers` response sink, no `node.req`/`node.res`. */
function webEvent(request: Request): {
  readonly event: Record<string, unknown>;
  readonly headers: Headers;
} {
  const headers = new Headers();
  const url = new URL(request.url);
  return {
    event: {
      url,
      path: `${url.pathname}${url.search}`,
      context: {},
      req: request,
      res: { headers },
    },
    headers,
  };
}

type NitroHook = (html: { head: string[] }, context: { event: unknown }) => Promise<void> | void;

function registerNitroPlugin(nuxt: Exports, options: unknown): NitroHook {
  const plugin = nuxt['livePreviewNitroPlugin'] as (o: unknown) => (nitro: unknown) => void;
  let hook: NitroHook | undefined;
  plugin(options)({
    hooks: {
      hook(_name: string, fn: NitroHook) {
        hook = fn;
      },
    },
  });
  if (hook === undefined) throw new Error('Nuxt: render:html hook not registered');
  return hook;
}

async function nextjsResponse(
  nextjs: Exports,
  options: unknown,
  request: Request,
): Promise<Response> {
  const create = nextjs['createLivePreviewMiddleware'] as (
    o: unknown,
  ) => (r: Request, x: Response) => Promise<Response>;
  return create(options)(request, html());
}

async function sveltekitResponse(
  sveltekit: Exports,
  options: unknown,
  request: Request,
  locals: Record<string, unknown>,
): Promise<Response> {
  const create = sveltekit['livePreviewHandle'] as (
    o: unknown,
  ) => (i: unknown) => Promise<Response>;
  const resolve = (
    _event: unknown,
    opts: { transformPageChunk?: (c: { html: string; done: boolean }) => string | undefined } = {},
  ): Promise<Response> =>
    Promise.resolve(
      new Response(opts.transformPageChunk?.({ html: PAGE, done: true }) ?? PAGE, {
        headers: { 'content-type': 'text/html' },
      }),
    );
  return create(options)({ event: { request, locals }, resolve });
}

async function astroResponse(
  astro: Exports,
  options: unknown,
  request: Request,
  locals: Record<string, unknown>,
): Promise<Response> {
  const create = astro['createLivePreviewMiddleware'] as (
    o: unknown,
  ) => (c: unknown, n: () => Promise<Response>) => Promise<Response>;
  return create(options)({ request, locals }, () => Promise.resolve(html()));
}

export async function edgeCases(modules: EdgeModules): Promise<readonly EdgeCase[]> {
  const { nextjs, sveltekit, astro, nuxt, server, fragment, payload } = modules;
  const issue = server['issuePreviewToken'] as IssueToken;
  const token = await issue({ audience: AUDIENCE, path: '/page' }, { secret: SECRET });
  const v1 = { defaults: 'v1', allowedOrigins: [ADMIN] };
  const v2 = strictOptions(server);

  return [
    {
      name: 'Next.js middleware injects for a preview request and leaves others alone',
      run: async () => {
        const response = await nextjsResponse(nextjs, v1, new Request(INTENT));
        check(injected(await response.text()), 'Next.js: no injection');
        check(hasFrameAncestors(response.headers), 'Next.js: no CSP');
        const untouched = await nextjsResponse(
          nextjs,
          v1,
          new Request('https://site.example.com/'),
        );
        check((await untouched.text()) === PAGE, 'Next.js: touched a non-preview response');
      },
    },
    {
      name: 'Next.js under v2 defaults injects only for an authorized context',
      run: async () => {
        const response = await nextjsResponse(nextjs, v2, authorizedRequest(token));
        check(injected(await response.text()), 'Next.js v2: authorized request not injected');
        const refused = await nextjsResponse(nextjs, v2, new Request(INTENT));
        check((await refused.text()) === PAGE, 'Next.js v2: injected without authorization');
      },
    },
    {
      name: 'SvelteKit handle injects through transformPageChunk and writes the nonce to locals',
      run: async () => {
        const locals: Record<string, unknown> = {};
        const response = await sveltekitResponse(sveltekit, v1, new Request(INTENT), locals);
        check(injected(await response.text()), 'SvelteKit: no injection');
        check(typeof locals['livePreviewNonce'] === 'string', 'SvelteKit: no nonce in locals');
      },
    },
    {
      name: 'SvelteKit under v2 defaults injects only for an authorized context',
      run: async () => {
        const response = await sveltekitResponse(sveltekit, v2, authorizedRequest(token), {});
        check(injected(await response.text()), 'SvelteKit v2: authorized request not injected');
        const refused = await sveltekitResponse(sveltekit, v2, new Request(INTENT), {});
        check((await refused.text()) === PAGE, 'SvelteKit v2: injected without authorization');
      },
    },
    {
      name: 'Astro middleware injects and hands the nonce to locals',
      run: async () => {
        const locals: Record<string, unknown> = {};
        const response = await astroResponse(astro, v1, new Request(INTENT), locals);
        check(injected(await response.text()), 'Astro: no injection');
        check(typeof locals['livePreviewNonce'] === 'string', 'Astro: no nonce in locals');
      },
    },
    {
      name: 'Astro under v2 defaults injects only for an authorized context',
      run: async () => {
        const response = await astroResponse(astro, v2, authorizedRequest(token), {});
        check(injected(await response.text()), 'Astro v2: authorized request not injected');
        const refused = await astroResponse(astro, v2, new Request(INTENT), {});
        check((await refused.text()) === PAGE, 'Astro v2: injected without authorization');
      },
    },
    {
      name: 'Nuxt Nitro plugin injects and sets CSP on a web-shaped h3 event',
      run: async () => {
        const hook = registerNitroPlugin(nuxt, v1);
        const { event, headers } = webEvent(new Request(INTENT));
        const head: string[] = [];
        await hook({ head }, { event });
        check(injected(head.join('')), 'Nuxt: no injection');
        check(hasFrameAncestors(headers), 'Nuxt: no CSP on the web response headers');
      },
    },
    {
      name: 'Nuxt under v2 defaults injects only for an authorized context',
      run: async () => {
        const hook = registerNitroPlugin(nuxt, v2);
        const authorized = webEvent(authorizedRequest(token));
        const head: string[] = [];
        await hook({ head }, { event: authorized.event });
        check(injected(head.join('')), 'Nuxt v2: authorized request not injected');
        check(hasFrameAncestors(authorized.headers), 'Nuxt v2: no CSP');
        const refusedHead: string[] = [];
        await hook({ head: refusedHead }, { event: webEvent(new Request(INTENT)).event });
        check(refusedHead.length === 0, 'Nuxt v2: injected without authorization');
      },
    },
    {
      name: 'server: a signed preview token round-trips on Web Crypto alone',
      run: async () => {
        const authorize = server['authorizePreviewRequest'] as Authorize;
        const strategy = { type: 'signed-token', secret: SECRET, audience: AUDIENCE };
        const ok = await authorize(authorizedRequest(token), strategy);
        check(ok.authorized, `server: valid token refused: ${JSON.stringify(ok)}`);
        const bad = await authorize(new Request(`${INTENT}&previewToken=${token}x`), strategy);
        check(!bad.authorized, 'server: tampered token accepted');
      },
    },
    {
      name: 'fragment and payload entries are edge-loadable and expose their public surface',
      run: () => {
        check(
          typeof fragment['createFragmentRoute'] === 'function' || Object.keys(fragment).length > 0,
          'fragment: entry evaluated to an empty namespace',
        );
        check(Object.keys(payload).length > 0, 'payload: entry evaluated to an empty namespace');
        return Promise.resolve();
      },
    },
  ];
}
