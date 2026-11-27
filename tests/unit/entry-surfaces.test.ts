import { describe, expect, it } from 'vitest';
import * as clientEntry from '../../src/client-entry';
import * as lexicalEntry from '../../src/lexical-entry';
import * as fragmentEntry from '../../src/fragment/index';

/**
 * The focused entries (roadmap 1.4.0) carry the symbols the packed-package
 * smoke (`scripts/check-package.ts`) asserts from the tarball, so a rename
 * fails here first, with a readable diff, rather than in the packed gate.
 */
describe('focused entry surfaces', () => {
  // Since 3.0 an entry exports no name tagged `@internal` at run time (ADR 0007, row 15):
  // the lists are what a project can import, complete.
  it('client: everything that runs in a browser (row 46)', () => {
    expect(Object.keys(clientEntry).sort()).toEqual([
      'CAPABILITY_DECLARATIONS',
      'CAPABILITY_DOCUMENTATION',
      'DIAGNOSTIC_CODES',
      'EventEmitter',
      'LivePreviewClient',
      'OriginDetector',
      'PluginManager',
      'VERSION',
      'bindNavigationLifecycle',
      'createAnalyticsPlugin',
      'createDocumentSession',
      'createPreviewFocusReporter',
      'createUnboundFieldsOverlayPlugin',
      'debugPlugin',
      'detectProtocolProfile',
      'documentSavePlugin',
      'escapeHtml',
      'highlightPlugin',
      'initLivePreview',
      'isExternalHttpUrl',
      'isLexicalContent',
      'isMorphBoundary',
      'isSafeUrl',
      'lexicalToHtml',
      'lexicalToPlainText',
      'markHydrated',
      'morphElement',
      'negotiateProtocol',
      'registerBlockRenderer',
      'registerBuiltinRenderer',
      'registerRouteRefresh',
      'reportPreviewFocus',
      'retainIslandBoundary',
      'sanitizeHtml',
      'setSanitizerPolicy',
      'setTrustedTypesPolicy',
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
});
