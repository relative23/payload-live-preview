/**
 * The page a fixed string URL (`admin.livePreview.url` of `manual-pages`) frames. The URL carries no
 * id, so the owner is the collection and claims every document of it. The real admin's create-state
 * spec (tests/real-payload/surface-create.spec.ts) frames it.
 */
import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

/** No client script: the runtime patches the bound nodes, and a hydrating component would overwrite them. */
export const csr = false;

export const load: PageServerLoad = ({ locals }) => {
  const preview = createPreviewBindings({
    authorization: locals.livePreviewAuthorization ?? null,
    owner: 'collection:manual-pages',
  });
  return {
    owner: preview.owner(),
    title: preview.bind('title'),
    subtitle: preview.bind('subtitle'),
  };
};
