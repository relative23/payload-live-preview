import { describe, expect, it } from 'vitest';
import { onRequest } from '@adapters/astro/middleware-entry';

/**
 * The module Astro loads for `mode: 'middleware'`. Nothing imported it, so v8
 * fell back to parsing the raw source, failed on `import type {`, and excluded
 * the file from coverage with a warning in the log. Importing it here both
 * restores the measurement and checks the one contract it has: Astro calls
 * `onRequest`, so `onRequest` has to be a middleware function.
 */

describe('astro middleware entry', () => {
  it('exports a callable onRequest built from the virtual options', async () => {
    expect(typeof onRequest).toBe('function');

    // Astro always supplies `locals`; the middleware stashes the nonce there.
    const context = {
      request: new Request('https://site.example.com/'),
      locals: {} as Record<string, unknown>,
    };
    const next = (): Promise<Response> =>
      Promise.resolve(
        new Response('<html><head></head><body></body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      );

    const response = await onRequest(context, next);
    // The fixture sets inject: 'always', so the runtime must be present.
    expect(await response.text()).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(typeof context.locals['livePreviewNonce']).toBe('string');
  });
});
