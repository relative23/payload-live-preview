/**
 * Two documents, each with a server-rendered boundary and an island. The
 * runtime runs with `scopeBindingsByOwner`, so an update that names
 * `global:a` renders a's boundary and notifies a's island, and leaves b's
 * alone: neither b's renderer nor b's island receives a's unsaved fields.
 */
import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

/** No client-side Svelte: the runtime owns the DOM here, as on `/hybrid`. */
export const csr = false;

export const load: PageServerLoad = ({ locals }) => {
  const authorization = locals.livePreviewAuthorization ?? null;
  const side = (name: 'a' | 'b', title: string) => {
    const preview = createPreviewBindings({ authorization, owner: `global:${name}` });
    return {
      name,
      owner: preview.owner(),
      boundary: preview.boundary('owned', { key: name, dependsOn: ['title'] }),
      panel: { title, letters: title.length },
      bindings: { title: preview.bind('title') },
    };
  };
  return { a: side('a', 'Title of A'), b: side('b', 'Title of B') };
};
