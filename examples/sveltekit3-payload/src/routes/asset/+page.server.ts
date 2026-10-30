/**
 * The asset-delivery page's server load: the same gated bindings as `/`, so
 * the only difference between the two routes is how the runtime arrives.
 */
import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  const preview = createPreviewBindings({
    authorization: locals.livePreviewAuthorization ?? null,
    owner: 'collection:pages',
  });
  return {
    authorized: preview.authorized,
    bindings: {
      owner: preview.owner(),
      title: preview.bind('title'),
      subtitle: preview.bind('subtitle'),
      count: preview.bind('count', { type: 'number' }),
    },
  };
};
