import { describe, expect, it } from 'vitest';
import { onRequest } from '@adapters/astro/middleware-entry';

describe('astro middleware entry', () => {
  it('exports a callable onRequest built from the virtual options', async () => {
    expect(typeof onRequest).toBe('function');
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
    expect(await response.text()).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(typeof context.locals['livePreviewNonce']).toBe('string');
  });
});
