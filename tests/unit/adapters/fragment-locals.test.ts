/**
 * A fragment's props see what the framework's own server code put on the
 * fragment request, as a page's load sees it on the page request: Astro's
 * `context.locals`, SvelteKit's `event.locals`, Nuxt's `event.context`.
 * Next.js has no such object, so the input carries `undefined` (ADR 0029).
 */
import { describe, expect, it } from 'vitest';
import { createFragmentEndpoint as createAstroEndpoint } from '@adapters/astro/fragments';
import { createFragmentEndpoint as createNextEndpoint } from '@adapters/nextjs/fragments';
import { createFragmentEndpoint as createNuxtEndpoint } from '@adapters/nuxt/fragments';
import { createFragmentEndpoint as createSvelteKitEndpoint } from '@adapters/sveltekit/fragments';
import type { FragmentEndpointOptions } from '@adapters/shared/fragment-endpoint';

const SITE = 'https://site.example.com';

/** The renderer is custom, so the options touch no component and suit every adapter. */
function options(seen: unknown[]): FragmentEndpointOptions<unknown> {
  return {
    registry: {
      notice: {
        component: 'Notice',
        props: ({ fields, locals }) => {
          seen.push(locals);
          return { text: String(fields['notice']) };
        },
      },
    },
    authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
    render: (_component, props) => Promise.resolve(`<p>${String(props['text'])}</p>`),
  };
}

function request(): Request {
  return new Request(`${SITE}/payload/fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE },
    body: JSON.stringify({
      fragment: 'notice',
      route: '/page',
      search: '',
      revision: 1,
      fields: { notice: 'hi' },
    }),
  });
}

describe("fragment props see the request's own server context (ADR 0029)", () => {
  it('SvelteKit: event.locals', async () => {
    const seen: unknown[] = [];
    const locals = { edition: 'preview' };
    const response = await createSvelteKitEndpoint(options(seen) as never)({
      request: request(),
      locals,
    });

    expect(response.status).toBe(200);
    expect(seen).toEqual([locals]);
  });

  it('Astro: context.locals', async () => {
    const seen: unknown[] = [];
    const locals = { edition: 'preview' };
    const response = await createAstroEndpoint(options(seen) as never)({
      request: request(),
      locals,
    });

    expect(response.status).toBe(200);
    expect(seen).toEqual([locals]);
  });

  it('Nuxt: event.context', async () => {
    const seen: unknown[] = [];
    const context = { edition: 'preview' };
    const response = await createNuxtEndpoint(options(seen) as never)(request(), { context });

    expect(response.status).toBe(200);
    expect(seen).toEqual([context]);
  });

  it('Next.js has none: undefined', async () => {
    const seen: unknown[] = [];
    const response = await createNextEndpoint(options(seen) as never)(request());

    expect(response.status).toBe(200);
    expect(seen).toEqual([undefined]);
  });

  it('an event without locals hands undefined, not the object of another request', async () => {
    const seen: unknown[] = [];
    const endpoint = createSvelteKitEndpoint(options(seen) as never);
    await endpoint({ request: request(), locals: { edition: 'first' } });
    await endpoint({ request: request() });

    expect(seen).toEqual([{ edition: 'first' }, undefined]);
  });
});
