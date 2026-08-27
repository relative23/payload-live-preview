import { beforeEach } from 'vitest';
import { createLivePreviewMiddleware as nextMiddleware } from '@adapters/nextjs/adapter';
import { livePreviewHandle } from '@adapters/sveltekit/adapter';
import { livePreviewNitroPlugin } from '@adapters/nuxt/adapter';
import { createLivePreviewMiddleware as astroMiddleware } from '@adapters/astro/middleware';
import { resetDeprecationWarnings } from '@adapters/shared/deprecation';
import {
  adapterConformance,
  PAGE,
  type ConformanceHarness,
  type ConformanceRequest,
} from './conformance';

/**
 * The four adapters through one behavioural suite. Each harness is only the
 * framework-specific way of handing the adapter a request and reading back
 * the response, header and nonce; every expectation lives in `conformance.ts`.
 */

beforeEach(() => {
  resetDeprecationWarnings();
});

function toRequest(request: ConformanceRequest): Request {
  return new Request(
    request.url,
    request.headers === undefined ? {} : { headers: request.headers },
  );
}

function response(request: ConformanceRequest): Response {
  const headers: Record<string, string> = {
    'content-type': request.contentType ?? 'text/html; charset=utf-8',
  };
  if (request.existingCsp !== undefined) headers['content-security-policy'] = request.existingCsp;
  return new Response(PAGE, { headers });
}

const nextjs: ConformanceHarness = {
  name: 'Next.js',
  async run(options, request) {
    const opts = { defaults: 'v1' as const, ...options };
    const middleware = nextMiddleware(opts);
    const result = await middleware(toRequest(request), response(request));
    return {
      body: await result.text(),
      csp: result.headers.get('content-security-policy'),
      nonce: undefined,
    };
  },
};

const sveltekit: ConformanceHarness = {
  name: 'SvelteKit',
  async run(options, request) {
    const opts = { defaults: 'v1' as const, ...options };
    const handle = livePreviewHandle(opts);
    const event = {
      request: toRequest(request),
      locals: {} as Record<string, unknown>,
    };
    const resolve = (
      _event: unknown,
      opts: {
        transformPageChunk?: (c: { html: string; done: boolean }) => string | undefined;
      } = {},
    ) => {
      const html = request.contentType === undefined || request.contentType.includes('html');
      const body = html ? (opts.transformPageChunk?.({ html: PAGE, done: true }) ?? PAGE) : PAGE;
      return Promise.resolve(new Response(body, { headers: response(request).headers }));
    };
    const result = await handle({ event, resolve });
    return {
      body: await result.text(),
      csp: result.headers.get('content-security-policy'),
      nonce: event.locals['livePreviewNonce'] as string | undefined,
    };
  },
};

const astro: ConformanceHarness = {
  name: 'Astro',
  async run(options, request) {
    const opts = { defaults: 'v1' as const, ...options };
    const middleware = astroMiddleware(opts);
    const locals: Record<string, unknown> = {};
    const result = await middleware({ request: toRequest(request), locals }, () =>
      Promise.resolve(response(request)),
    );
    return {
      body: await result.text(),
      csp: result.headers.get('content-security-policy'),
      nonce: locals['livePreviewNonce'] as string | undefined,
    };
  },
};

interface NitroEvent {
  readonly path: string;
  readonly context: Record<string, unknown>;
  readonly node: {
    readonly req: { readonly url: string; readonly headers: Record<string, string> };
    readonly res: {
      getHeader: (name: string) => string | undefined;
      setHeader: (name: string, value: string) => void;
    };
  };
}

const nuxt: ConformanceHarness = {
  name: 'Nuxt',
  async run(options, request) {
    // Nitro fires render:html only for HTML renders; a non-HTML response never
    // reaches the plugin, which is what an empty head models here.
    if (request.contentType !== undefined && !request.contentType.includes('html')) {
      return { body: '', csp: null, nonce: undefined };
    }
    let hook:
      ((h: { head: string[] }, c: { event: NitroEvent }) => void | Promise<void>) | undefined;
    livePreviewNitroPlugin({ defaults: 'v1' as const, ...options })({
      hooks: {
        hook(_name: 'render:html', fn: NonNullable<typeof hook>) {
          hook = fn;
        },
      },
    });
    const written: Record<string, string> = {};
    if (request.existingCsp !== undefined) written['content-security-policy'] = request.existingCsp;
    const url = new URL(request.url);
    const event: NitroEvent = {
      path: `${url.pathname}${url.search}`,
      context: {},
      node: {
        req: {
          url: `${url.pathname}${url.search}`,
          headers: { host: url.host, ...request.headers },
        },
        res: {
          getHeader: (name) => written[name.toLowerCase()],
          setHeader: (name, value) => {
            written[name.toLowerCase()] = value;
          },
        },
      },
    };
    const head: string[] = [];
    await hook?.({ head }, { event });
    return {
      body: head.join(''),
      csp: written['content-security-policy'] ?? null,
      nonce: event.context['livePreviewNonce'] as string | undefined,
    };
  },
};

for (const harness of [nextjs, sveltekit, astro, nuxt]) adapterConformance(harness);
