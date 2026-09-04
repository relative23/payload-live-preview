import { beforeEach, describe } from 'vitest';
import { createLivePreviewMiddleware as nextMiddleware } from '@adapters/nextjs/adapter';
import { livePreviewHandle } from '@adapters/sveltekit/adapter';
import { livePreviewNitroPlugin } from '@adapters/nuxt/adapter';
import { createLivePreviewMiddleware as astroMiddleware } from '@adapters/astro/middleware';
import { resetDevWarnings } from '@adapters/shared/dev-warning';
import {
  adapterConformance,
  PAGE,
  type ConformanceHarness,
  type ConformanceRequest,
} from './conformance';

beforeEach(() => {
  resetDevWarnings();
});

function toRequest(request: ConformanceRequest): Request {
  return new Request(
    request.url,
    request.headers === undefined ? {} : { headers: request.headers },
  );
}

function responseHeaders(request: ConformanceRequest): Record<string, string> {
  return {
    'content-type': request.contentType ?? 'text/html; charset=utf-8',
    ...request.responseHeaders,
  };
}

const nextjs: ConformanceHarness = {
  name: 'Next.js',
  exposesLocals: false,
  async run(options, request) {
    const middleware = nextMiddleware(options);
    const result = await middleware(
      toRequest(request),
      new Response(PAGE, { headers: responseHeaders(request) }),
    );
    return { body: await result.text(), header: (name) => result.headers.get(name), locals: {} };
  },
};

const sveltekit: ConformanceHarness = {
  name: 'SvelteKit',
  exposesLocals: true,
  async run(options, request) {
    const handle = livePreviewHandle(options);
    const event = { request: toRequest(request), locals: {} as Record<string, unknown> };
    const resolve = (
      _event: unknown,
      opts: {
        transformPageChunk?: (c: { html: string; done: boolean }) => string | undefined;
      } = {},
    ) => {
      const html = request.contentType === undefined || request.contentType.includes('html');
      let body = PAGE;
      if (html && opts.transformPageChunk !== undefined) {
        // SvelteKit: `(await transformPageChunk(...)) || ''` — a falsy chunk becomes empty.
        const transformed = opts.transformPageChunk({ html: PAGE, done: true });
        body = transformed === undefined || transformed === '' ? '' : transformed;
      }
      return Promise.resolve(new Response(body, { headers: responseHeaders(request) }));
    };
    const result = await handle({ event, resolve });
    return {
      body: await result.text(),
      header: (name) => result.headers.get(name),
      locals: event.locals,
    };
  },
};

const astro: ConformanceHarness = {
  name: 'Astro',
  exposesLocals: true,
  async run(options, request) {
    const middleware = astroMiddleware(options);
    const locals: Record<string, unknown> = {};
    const result = await middleware({ request: toRequest(request), locals }, () =>
      Promise.resolve(new Response(PAGE, { headers: responseHeaders(request) })),
    );
    return { body: await result.text(), header: (name) => result.headers.get(name), locals };
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
  exposesLocals: true,
  async run(options, request) {
    // Nitro fires render:html only for HTML renders; an empty head models a non-HTML response.
    if (request.contentType !== undefined && !request.contentType.includes('html')) {
      return { body: '', header: () => null, locals: {} };
    }
    let hook:
      ((h: { head: string[] }, c: { event: NitroEvent }) => void | Promise<void>) | undefined;
    livePreviewNitroPlugin(options)({
      hooks: {
        hook(_name: 'render:html', fn: NonNullable<typeof hook>) {
          hook = fn;
        },
      },
    });
    const written: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.responseHeaders ?? {})) {
      written[name.toLowerCase()] = value;
    }
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
      header: (name) => written[name.toLowerCase()] ?? null,
      locals: event.context,
    };
  },
};

describe.each([nextjs, sveltekit, astro, nuxt])('$name', (harness) => {
  adapterConformance(harness);
});
