/**
 * Reveal-edited-field browser fixture, the SvelteKit row of reveal.spec.ts.
 * The same page as `examples/astro-payload/src/pages/reveal.astro`: `heroTitle`
 * on top, `footer` below a 2,200px spacer, both owned by `global:reveal` —
 * the hook scopes bindings by owner, so an update names the document.
 *
 * Keyed on the hook's verdict like every other page here: a public response
 * carries no `data-payload-*` attribute at all.
 */
import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  const preview = createPreviewBindings({
    authorization: locals.livePreviewAuthorization ?? null,
    owner: 'global:reveal',
  });
  return {
    authorized: preview.authorized,
    bindings: {
      owner: preview.owner(),
      heroTitle: preview.bind('heroTitle'),
      footer: preview.bind('footer'),
    },
  };
};
