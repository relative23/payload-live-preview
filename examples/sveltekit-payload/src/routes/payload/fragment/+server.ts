/**
 * The fragment endpoint as a SvelteKit route handler (docs/hybrid.md). It
 * verifies the same signed token the page did — the endpoint authorizes every
 * request anew, so an expired token means a fallback, not stale markup.
 */
import { createFragmentEndpoint } from 'payload-live-preview/sveltekit';
import { authorizePreviewRequest, createPreviewBindings } from 'payload-live-preview';
import Hero from '$lib/Hero.svelte';
import { heroProps } from '$lib/hero';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '$lib/preview';
import type { RequestHandler } from './$types';

const endpoint = createFragmentEndpoint({
  registry: {
    hero: {
      component: Hero,
      props: ({ fields, authorization }) => {
        // The same helper the page's load uses, from this request's own
        // verdict: the fragment's markup carries the bindings the page would
        // have carried, and nothing more.
        const preview = createPreviewBindings({ authorization });
        return {
          ...heroProps(fields),
          bindings: { title: preview.bind('title'), body: preview.bind('body') },
        };
      },
    },
  },
  authorizePreview: (request) =>
    authorizePreviewRequest(request, {
      type: 'signed-token',
      secret: PREVIEW_TOKEN_SECRET,
      audience: PREVIEW_AUDIENCE,
    }),
});

export const POST: RequestHandler = endpoint;
