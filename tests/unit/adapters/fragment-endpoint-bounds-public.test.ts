import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint as createAstroEndpoint } from '@adapters/astro/fragments';
import { createFragmentEndpoint as createNextEndpoint } from '@adapters/nextjs/fragments';
import { createFragmentEndpoint as createSvelteKitEndpoint } from '@adapters/sveltekit/fragments';
import { createFragmentEndpoint as createNuxtEndpoint } from '@adapters/nuxt/fragments';
import type {
  FragmentEndpointOptions as SharedEndpointOptions,
  FragmentRenderInput,
} from '@adapters/shared/fragment-endpoint';

/**
 * Every public framework wrapper must preserve the shared endpoint's byte cap.
 * A transport-provided length is only an early refusal; the streamed bytes are
 * authoritative when that header is missing or smaller than the body.
 */

const SITE = 'https://site.example.com';
const Component = {};
const ReactComponent = (_props: never): null => null;

type Limits = NonNullable<SharedEndpointOptions<unknown>['limits']>;
type RenderSpy = ReturnType<
  typeof vi.fn<
    (
      component: unknown,
      props: Record<string, unknown>,
      input: FragmentRenderInput,
    ) => Promise<string>
  >
>;
type PublicHandler = (request: Request) => Promise<Response>;
interface PublicWrapper {
  readonly name: string;
  readonly create: (render: RenderSpy, limits: Limits) => PublicHandler;
}

const authorize = { type: 'verifier', verify: () => ({ subject: 'editor' }) } as const;

const wrappers = [
  {
    name: 'Astro',
    create: (render, limits) => {
      const endpoint = createAstroEndpoint({
        registry: { hero: { component: Component, props: () => ({}) } },
        authorize,
        limits,
        render,
      });
      return (request) => endpoint({ request });
    },
  },
  {
    name: 'Next.js',
    create: (render, limits) =>
      createNextEndpoint({
        registry: { hero: { component: ReactComponent, props: () => ({}) } },
        authorize,
        limits,
        render,
      }),
  },
  {
    name: 'SvelteKit',
    create: (render, limits) => {
      const endpoint = createSvelteKitEndpoint({
        registry: { hero: { component: Component, props: () => ({}) } },
        authorize,
        limits,
        render,
      });
      return (request) => endpoint({ request });
    },
  },
  {
    name: 'Nuxt',
    create: (render, limits) =>
      createNuxtEndpoint({
        registry: { hero: { component: Component, props: () => ({}) } },
        authorize,
        limits,
        render,
      }),
  },
] satisfies readonly PublicWrapper[];

afterEach(() => {
  vi.useRealTimers();
});

function streamingRequest(raw: string, declared: string | undefined): Request {
  const bytes = new TextEncoder().encode(raw);
  const midpoint = Math.floor(bytes.byteLength / 2);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, midpoint));
      controller.enqueue(bytes.slice(midpoint));
      controller.close();
    },
  });
  const headers = new Headers({
    'content-type': 'application/json',
    origin: SITE,
    'sec-fetch-site': 'same-origin',
  });
  if (declared !== undefined) headers.set('content-length', declared);
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  };
  return new Request(`${SITE}/payload/fragment`, init);
}

describe('public fragment endpoints — streamed request bounds', () => {
  it.each([
    {
      wrapper: wrappers[0]!,
      length: { name: 'without Content-Length', declared: undefined },
    },
    {
      wrapper: wrappers[0]!,
      length: { name: 'with an underdeclared Content-Length', declared: '1' },
    },
    {
      wrapper: wrappers[1]!,
      length: { name: 'without Content-Length', declared: undefined },
    },
    {
      wrapper: wrappers[1]!,
      length: { name: 'with an underdeclared Content-Length', declared: '1' },
    },
    {
      wrapper: wrappers[2]!,
      length: { name: 'without Content-Length', declared: undefined },
    },
    {
      wrapper: wrappers[2]!,
      length: { name: 'with an underdeclared Content-Length', declared: '1' },
    },
    {
      wrapper: wrappers[3]!,
      length: { name: 'without Content-Length', declared: undefined },
    },
    {
      wrapper: wrappers[3]!,
      length: { name: 'with an underdeclared Content-Length', declared: '1' },
    },
  ] as const)('$wrapper.name rejects multibyte bytes $length.name', async ({ wrapper, length }) => {
    const raw = JSON.stringify({
      fragment: 'hero',
      route: '/page',
      search: '?preview=true',
      revision: 1,
      fields: { title: '€'.repeat(32) },
    });
    const actualBytes = new TextEncoder().encode(raw).byteLength;
    const bodyBytes = raw.length;
    expect(actualBytes).toBeGreaterThan(bodyBytes);
    const render = vi.fn(() => Promise.resolve('<h1>must not render</h1>'));
    const endpoint = wrapper.create(render, { bodyBytes });

    const response = await endpoint(streamingRequest(raw, length.declared));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'body' });
    expect(render).not.toHaveBeenCalled();
  });

  it('lets SvelteKit write its 413 without cancelling the Node request bridge', async () => {
    const raw = JSON.stringify({
      fragment: 'hero',
      route: '/page',
      search: '',
      revision: 1,
      fields: { title: '界'.repeat(80) },
    });
    const bytes = new TextEncoder().encode(raw);
    const bodyBytes = 64;
    let offset = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 32, bytes.byteLength);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
      cancel,
    });
    const request = new Request(`${SITE}/payload/fragment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: SITE,
        'transfer-encoding': 'chunked',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const render = vi.fn(() => Promise.resolve('<h1>must not render</h1>'));
    const endpoint = wrappers[2]!.create(render, { bodyBytes });

    const response = await endpoint(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'body' });
    expect(offset).toBe(bytes.byteLength);
    expect(cancel).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it.each(wrappers)('$name forwards the whole-request deadline and signal', async (wrapper) => {
    vi.useFakeTimers();
    let renderSignal: AbortSignal | undefined;
    const render = vi.fn(
      (_component: unknown, _props: Record<string, unknown>, input: FragmentRenderInput) => {
        renderSignal = input.signal;
        return new Promise<string>((resolve) => {
          input.signal.addEventListener('abort', () => resolve('<h1>late</h1>'), { once: true });
          setTimeout(() => resolve('<h1>fallback</h1>'), 100);
        });
      },
    );
    const endpoint = wrapper.create(render, { timeoutMs: 100, totalTimeoutMs: 25 });
    const raw = JSON.stringify({
      fragment: 'hero',
      route: '/page',
      search: '',
      revision: 1,
      fields: { title: 'Hello' },
    });

    const pending = endpoint(streamingRequest(raw, undefined));
    await vi.advanceTimersByTimeAsync(101);
    const response = await pending;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'timeout' });
    expect(renderSignal?.aborted).toBe(true);
  });
});
