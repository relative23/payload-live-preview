/**
 * The hybrid page's load: the same authorization verdict decides the bindings
 * and the boundary. An unauthorized response carries neither, so an anonymous
 * visitor never learns the registry id or which fields it depends on.
 */
import { createPreviewBindings } from 'payload-live-preview';
import { heroProps } from '$lib/hero';
import type { PageServerLoad } from './$types';

/**
 * No client-side Svelte on this route. The runtime writes into the DOM and the
 * framework does not know, so a component that hydrates afterwards can reset
 * what was patched — the hydration caveat in docs/sveltekit.md. A page built
 * around server-rendered boundaries has nothing to hydrate anyway.
 */
export const csr = false;

export const load: PageServerLoad = ({ locals }) => {
  const preview = createPreviewBindings({
    authorization: locals.livePreviewAuthorization ?? null,
    owner: 'global:home',
  });
  return {
    hero: heroProps({}),
    boundary: preview.boundary('hero', { dependsOn: ['title', 'subtitle', 'body'] }),
    bindings: {
      owner: preview.owner(),
      title: preview.bind('title'),
      body: preview.bind('body'),
      footer: preview.bind('footer'),
    },
  };
};
