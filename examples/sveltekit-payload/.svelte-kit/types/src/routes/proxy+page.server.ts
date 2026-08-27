// @ts-nocheck
/**
 * The preview page's server load: one authorization verdict, taken from the
 * hook, decides whether the markup carries any `data-payload-*` attribute
 * at all. A public response is byte-identical to one that never knew about
 * live preview; an authorized one carries the bindings the runtime patches.
 *
 * The binding helpers return plain attribute objects, so they serialize
 * through `load` and spread into the template unchanged.
 */
import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

export const load = ({ locals }: Parameters<PageServerLoad>[0]) => {
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
      hero: preview.bind('hero', { type: 'image', alt: 'hero.alt' }),
      body: preview.bind('body', { richtext: true }),
      count: preview.bind('count', { type: 'number' }),
      publishedAt: preview.bind('publishedAt'),
      tags: preview.bind('tags', { type: 'array', arrayTemplate: '<li>{{value}}</li>' }),
      ctaLabel: preview.bind('ctaLabel', { href: 'ctaUrl' }),
    },
  };
};
