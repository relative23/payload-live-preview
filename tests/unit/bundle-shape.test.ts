/**
 * Entry-shape tests. They probe no behaviour: they hold the cut between the two
 * entries a project chooses between (ADR 0007, row 46). `payload-live-preview/client`
 * is what runs in a browser, and the root is that entry and what a server needs. A page
 * that loads an entry without a bundler loads it whole, so a name that pulls the script
 * generator, which holds the runtime as text, into `client-entry.ts` is paid for by every
 * such page; that is what fires here.
 */

import { describe, expect, it } from 'vitest';
import * as rootEntry from '../../src/index';
import * as clientEntry from '../../src/client-entry';

describe('entry shape: the root and `/client`', () => {
  it('the root has every name of `/client`, as the same binding', () => {
    const client = clientEntry as Record<string, unknown>;
    const root = rootEntry as Record<string, unknown>;

    expect(Object.keys(client).filter((name) => root[name] !== client[name])).toEqual([]);
  });

  it('what the root adds is the generator and the server helpers, and nothing else', () => {
    expect(
      Object.keys(rootEntry)
        .filter((name) => !(name in clientEntry))
        .sort(),
    ).toEqual([
      'authorizePreviewRequest',
      'bind',
      'bindByPath',
      'buildFrameAncestors',
      'createPreviewBindings',
      'generateCspNonce',
      'generateInlineScript',
      'hasPreviewIntent',
      'isAuthorizedPreviewContext',
      'issuePreviewToken',
      'mergeCspHeader',
      'previewBindingsFromLocals',
      'wrapWithScriptTag',
    ]);
  });
});
