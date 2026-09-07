/**
 * A Payload-shaped server for the suites that ask what a merge is worth: the
 * panel posts a relationship as a bare id, and only the merged document carries
 * the title a page can show. Shared by the request-count suite (Z4) and the
 * leading-apply suite (Z5), which drive the same page from opposite ends.
 */

import { vi } from 'vitest';
import type { FieldRenderer } from '@core/types';

/** The venue the merge resolves; the raw message carries its id alone. */
export const VENUES: Record<string, unknown> = {
  'venue-1': { id: 'venue-1', title: 'Halle Sieben', url: '/venues/halle-sieben' },
  'venue-2': { id: 'venue-2', title: 'Halle Acht', url: '/venues/halle-acht' },
};

/** A server that populates what Payload's panel posts as bare ids. */
export function mergingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => {
    const sent = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(sent) as { data: Record<string, unknown> };
    const doc: Record<string, unknown> = { ...body.data };
    const venue = doc['venue'];
    if (typeof venue === 'string') doc['venue'] = VENUES[venue] ?? { id: venue };
    return Promise.resolve(
      new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

/** Renders the title of a populated relationship, and the bare value otherwise. */
export function relationshipRenderer(): FieldRenderer {
  return {
    name: 'relationship',
    render(target, value) {
      const record =
        typeof value === 'object' && value !== null
          ? (value as { title?: string; id?: string })
          : undefined;
      target.element.textContent =
        record === undefined ? String(value) : (record.title ?? record.id ?? '');
    },
  };
}
