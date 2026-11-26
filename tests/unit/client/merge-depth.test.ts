import { describe, expect, it } from 'vitest';
import { LivePreviewClient, type LivePreviewClientConfig } from '@client/index';

/**
 * ADR 0007, entry 10: a client that sets `serverURL` must choose an explicit
 * `mergeDepth`. Until 3.0 `defaults: 'v1'` kept the 1.x default of 1.
 */
describe('LivePreviewClient — explicit mergeDepth', () => {
  it('refuses serverURL without mergeDepth', () => {
    expect(() => new LivePreviewClient({ serverURL: 'https://cms.example.com' })).toThrow(
      /mergeDepth/,
    );
  });

  it('accepts serverURL with an explicit mergeDepth', () => {
    const client = new LivePreviewClient({ serverURL: 'https://cms.example.com', mergeDepth: 0 });
    void client.destroy();
  });

  it("refuses `defaults: 'v1'`, which exempted a client from the rule until 3.0", () => {
    const removed = { defaults: 'v1', serverURL: 'https://cms.example.com' };

    expect(() => new LivePreviewClient(removed as LivePreviewClientConfig)).toThrow(
      "payload-live-preview: `defaults: 'v1'` was removed in 3.0.",
    );
  });
});
