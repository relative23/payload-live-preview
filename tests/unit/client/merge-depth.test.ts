import { describe, expect, it } from 'vitest';
import { LivePreviewClient } from '@client/index';

/**
 * 2.0 (ADR 0007, entry 10): a client that sets `serverURL` must choose an
 * explicit `mergeDepth`; `defaults: 'v1'` keeps the 1.x default of 1.
 */
describe('LivePreviewClient — explicit mergeDepth under the 2.0 defaults', () => {
  it('refuses serverURL without mergeDepth', () => {
    expect(() => new LivePreviewClient({ serverURL: 'https://cms.example.com' })).toThrow(
      /mergeDepth/,
    );
  });

  it('accepts serverURL with an explicit mergeDepth', () => {
    const client = new LivePreviewClient({ serverURL: 'https://cms.example.com', mergeDepth: 0 });
    void client.destroy();
  });

  it('keeps the 1.x default under defaults: v1', () => {
    const client = new LivePreviewClient({
      defaults: 'v1',
      serverURL: 'https://cms.example.com',
    });
    void client.destroy();
  });
});
