// @ts-nocheck
/**
 * Two documents on one page, sharing a field name. The runtime runs with
 * `scopeBindingsByOwner`, so an update that names `global:a` patches the
 * `title` inside the `a` subtree and leaves `b` untouched — the case a
 * content site hits the moment a page shows a promotion next to a post.
 */
import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

export const load = ({ locals }: Parameters<PageServerLoad>[0]) => {
  const authorization = locals.livePreviewAuthorization ?? null;
  const a = createPreviewBindings({ authorization, owner: 'global:a' });
  const b = createPreviewBindings({ authorization, owner: 'global:b' });
  return {
    authorized: a.authorized,
    a: { owner: a.owner(), title: a.bind('title') },
    b: { owner: b.owner(), title: b.bind('title') },
  };
};
