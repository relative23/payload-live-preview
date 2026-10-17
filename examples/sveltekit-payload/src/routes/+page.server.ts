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
import { PAYLOAD_SERVER_URL } from '$lib/preview.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  const preview = createPreviewBindings({
    authorization: locals.livePreviewAuthorization ?? null,
    // Owner scoping is on (hooks.server.ts): an update patches only the document
    // it names. The real admin edits the homepage global, the mock admin a page.
    owner: PAYLOAD_SERVER_URL === undefined ? 'collection:pages' : 'global:homepage',
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
      // The populated path of the relationship a real admin posts as an id (hooks.server.ts asks
      // the runtime to populate it); the page renders it only against a real admin.
      authorEmail: preview.bind('author.email'),
    },
    populated: PAYLOAD_SERVER_URL !== undefined,
  };
};
