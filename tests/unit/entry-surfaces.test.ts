import { describe, expect, it } from 'vitest';
import * as clientEntry from '../../src/client-entry';
import * as structuralEntry from '../../src/structural-entry';
import * as lexicalEntry from '../../src/lexical-entry';
import * as pluginsEntry from '../../src/plugins-entry';
import * as fragmentEntry from '../../src/fragment/index';

/**
 * The focused entries (roadmap 1.4.0) carry the symbols the packed-package
 * smoke (`scripts/check-package.ts`) asserts from the tarball, so a rename
 * fails here first, with a readable diff, rather than in the packed gate.
 */
describe('focused entry surfaces', () => {
  it('client', () => {
    expect(typeof clientEntry.LivePreviewClient).toBe('function');
    expect(typeof clientEntry.initLivePreview).toBe('function');
  });
  // Since 3.0 an entry exports no name tagged `@internal` at run time (ADR 0007, row 15):
  // the lists are what a project can import, complete.
  it('structural: the morph and the two boundary rules', () => {
    expect(Object.keys(structuralEntry).sort()).toEqual([
      'isMorphBoundary',
      'morphElement',
      'retainIslandBoundary',
    ]);
  });
  it('lexical: the renderer, the shape test and the registrations', () => {
    expect(Object.keys(lexicalEntry).sort()).toEqual([
      'isLexicalContent',
      'lexicalToHtml',
      'lexicalToPlainText',
      'registerBlockRenderer',
      'registerDefaultBlocks',
      'registerLexicalNode',
    ]);
  });
  it('fragment: the two strategies and the codes', () => {
    expect(Object.keys(fragmentEntry).sort()).toEqual([
      'DIAGNOSTIC_CODES',
      'createFragmentStrategy',
      'createRouteStrategy',
    ]);
  });
  it('plugins', () => {
    expect(typeof pluginsEntry.PluginManager).toBe('function');
    expect(typeof pluginsEntry.createAnalyticsPlugin).toBe('function');
    expect(pluginsEntry.highlightPlugin).toBeDefined();
  });
});
