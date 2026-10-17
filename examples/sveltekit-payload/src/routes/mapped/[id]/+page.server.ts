/**
 * A collection document at a path of its own, the way the plugin's function sends `mapped-pages` to
 * `/mapped/<id>` once the document has an id. The owner names that collection and id; owner scoping
 * is on (hooks.server.ts), so only an update for this document patches the page. The real admin's
 * create-state spec (tests/real-payload/surface-create.spec.ts) frames it.
 */
import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

/** No client script: the runtime patches the bound nodes, and a hydrating component would overwrite them. */
export const csr = false;

export const load: PageServerLoad = ({ locals, params }) => {
  const preview = createPreviewBindings({
    authorization: locals.livePreviewAuthorization ?? null,
    owner: `collection:mapped-pages:${params.id}`,
  });
  return {
    owner: preview.owner(),
    title: preview.bind('title'),
    subtitle: preview.bind('subtitle'),
  };
};
