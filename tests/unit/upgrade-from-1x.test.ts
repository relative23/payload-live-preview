import { describe, expect, it } from 'vitest';
/* eslint-disable @typescript-eslint/no-deprecated -- the deprecation is what this file holds */
import { hasPreviewIntent, isPreviewRequest } from '@/index';
import {
  hasPreviewIntent as astroHasPreviewIntent,
  isPreviewRequest as astroIsPreviewRequest,
} from '@adapters/astro/index';

/**
 * What a 1.x project keeps.
 *
 * Measured against the published 1.8.1 surface: of the 114 names its root entry
 * exported, eight are absent from 2.0. Seven of those moved behind
 * `definePreview()` (ADR 0007, ledger row 9) or changed shape, where an alias
 * would restore the very defaults the move removed. One was a plain rename, and
 * that one is aliased — so the single most common 1.x import keeps compiling.
 */

describe('the 1.x name that stayed', () => {
  it('is on every entry that exported it, not only the root', () => {
    // 1.8.1 exported it from `./astro` as well, and an Astro project is this
    // package's most common consumer — an alias only at the root would have
    // left exactly them with the edit.
    expect(astroIsPreviewRequest).toBe(astroHasPreviewIntent);
    expect(astroIsPreviewRequest).toBe(isPreviewRequest);
  });

  it('`isPreviewRequest` is `hasPreviewIntent`, not a copy of it', () => {
    expect(isPreviewRequest).toBe(hasPreviewIntent);
  });

  it('answers the way 1.x answered', () => {
    const request = { url: 'https://site.example/page?preview=true', headers: { get: () => null } };

    expect(isPreviewRequest(request)).toBe(true);
    expect(isPreviewRequest({ ...request, url: 'https://site.example/page' })).toBe(false);
  });

  it('takes the options 1.x took', () => {
    const request = {
      url: 'https://site.example/page',
      headers: { get: (n: string) => (n.toLowerCase() === 'sec-fetch-dest' ? 'iframe' : null) },
    };

    expect(isPreviewRequest(request, { signals: ['fetch-dest'] })).toBe(true);
    expect(isPreviewRequest(request, { signals: ['query'] })).toBe(false);
  });
});
