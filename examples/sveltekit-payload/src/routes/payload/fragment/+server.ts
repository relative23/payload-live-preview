/**
 * The fragment endpoint as a SvelteKit route handler (docs/hybrid.md). It
 * verifies the same signed token the page did — the endpoint authorizes every
 * request anew, so an expired token means a fallback, not stale markup.
 */
import { createFragmentEndpoint } from 'payload-live-preview/sveltekit';
import { authorizePreviewRequest, createPreviewBindings } from 'payload-live-preview';
import Hero from '$lib/Hero.svelte';
import OwnedPanel from '$lib/OwnedPanel.svelte';
import Notice from '$lib/Notice.svelte';
import { heroProps } from '$lib/hero';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '$lib/preview.server';
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
    // `/hybrid`: a component the page shows only once a fragment rendered it.
    notice: {
      component: Notice,
      props: ({ fields, locals }) => ({
        text: typeof fields['notice'] === 'string' ? fields['notice'] : '',
        // Read as the page's load reads it, from what this request's hook set.
        edition: (locals as App.Locals | undefined)?.edition ?? '',
      }),
    },
    // `/owners-hybrid`: one panel per document, told apart by the boundary key.
    owned: {
      component: OwnedPanel,
      props: ({ fields, authorization }) => {
        const preview = createPreviewBindings({ authorization });
        const title = typeof fields['title'] === 'string' ? fields['title'] : '';
        return { title, letters: title.length, bindings: { title: preview.bind('title') } };
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
