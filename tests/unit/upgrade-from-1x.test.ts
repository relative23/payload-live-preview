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
 * Measured against the published 1.8.1 surface: of the 103 names its root entry
 * exported, six are absent from 2.0: the fetch helpers and their option types,
 * which moved behind `definePreview()` (ADR 0007, ledger row 9), where an alias
 * would restore the very defaults the move removed. The one plain rename,
 * `isPreviewRequest`, is aliased — so the single most common 1.x import keeps
 * compiling.
 */

describe('the 1.x name that stayed', () => {
  it('is on every entry that exported it, not only the root', () => {
    // 1.8.1 exported it from `./astro` as well, and an Astro project is this
    // package's most common consumer — an alias only at the root would have
    // left exactly them with the edit.
    expect(astroIsPreviewRequest).toBe(isPreviewRequest);
  });

  it('answers as `hasPreviewIntent` on both entries, and says once that 3.0 removes it (ADR 0026)', () => {
    const request = { url: 'https://site.example/page?preview=true', headers: { get: () => null } };

    expect(astroIsPreviewRequest(request)).toBe(astroHasPreviewIntent(request));
    expect(isPreviewRequest(request)).toBe(hasPreviewIntent(request));
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
