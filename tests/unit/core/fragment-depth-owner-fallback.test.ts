/**
 * A field-depth refusal still patches the current document owner. A host may
 * replace that owner's boundary while HTTP is in flight; the detached copy and
 * another owner's identical registry id must receive no write.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint } from '@adapters/astro/fragments';
import { createFragmentStrategy } from '@fragment/index';
import { post, startRuntime, TRUSTED } from '../../helpers/runtime';

describe('fragment field-depth refusal with document owner scoping', () => {
  it.each([0, '0'])('patches the replaced owner boundary for identity %s', async (id) => {
    const verify = vi.fn(() => ({ subject: 'review-editor' }));
    const props = vi.fn(() => ({ title: 'Server title' }));
    const render = vi.fn(() => Promise.resolve('<h1>Server title</h1>'));
    const server = createFragmentEndpoint({
      registry: { hero: { component: {}, props } },
      authorize: { type: 'verifier', verify },
      render,
      limits: { fieldDepth: 0 },
    });
    let release: (() => void) | undefined;
    let response: Response | undefined;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      const result = await server({
        request: new Request(new URL(path, 'https://site.example.com'), init),
      });
      response = result.clone();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return result;
    });
    const previous = document.body.innerHTML;
    const markup = (owner: string, value: string) =>
      `<div data-payload-owner="${owner}"><section data-payload-fragment="hero" ` +
      'data-payload-fragment-key="same"><h1 data-payload-field="title">' +
      `${value}</h1></section></div>`;
    document.body.innerHTML =
      markup('collection:posts:0', 'Saved owner') + markup('collection:posts:other', 'Other owner');
    const { runtime, emitter } = startRuntime({
      scopeBindingsByOwner: true,
      eventSourcePolicy: 'any',
      strategies: {
        fragment: createFragmentStrategy({
          endpoint: '/payload/fragment',
          fetch,
          location: { pathname: '/page', search: '?preview=true' },
        }),
      },
    });
    const errors: unknown[] = [];
    emitter.on('error', (event) => {
      errors.push(event);
    });
    try {
      post(
        { id, title: 'Current unsaved owner' },
        { extra: { collectionSlug: 'posts' }, origin: TRUSTED },
      );
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      const planned = document.querySelector('[data-payload-owner="collection:posts:0"] section')!;
      const replacement = planned.cloneNode(true);
      planned.replaceWith(replacement);
      release?.();
      await vi.waitFor(() => {
        expect(replacement.textContent).toBe('Current unsaved owner');
        expect(runtime.inspect().fragments).toMatchObject({ rendered: 0, failed: 1, inFlight: 0 });
      });
      expect(planned.textContent).toBe('Saved owner');
      expect(
        document.querySelector('[data-payload-owner="collection:posts:other"]')?.textContent,
      ).toBe('Other owner');
      expect(errors).toEqual([expect.objectContaining({ code: 'LP0801', context: 'fragment' })]);
      expect(response?.status).toBe(400);
      expect(await response?.json()).toEqual({ error: 'field-depth', maxDepth: 0 });
      expect(fetch).toHaveBeenCalledOnce();
      expect(verify).not.toHaveBeenCalled();
      expect(props).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      release?.();
      runtime.destroy();
      document.body.innerHTML = previous;
    }
  });
});
