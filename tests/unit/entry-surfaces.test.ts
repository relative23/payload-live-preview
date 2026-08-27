import { describe, expect, it } from 'vitest';
import * as clientEntry from '../../src/client-entry';
import * as structuralEntry from '../../src/structural-entry';
import * as lexicalEntry from '../../src/lexical-entry';
import * as pluginsEntry from '../../src/plugins-entry';

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
  it('structural', () => {
    expect(typeof structuralEntry.createStructuralArrayRenderer).toBe('function');
    expect(typeof structuralEntry.morphElement).toBe('function');
    expect(typeof structuralEntry.applyStructuralPatches).toBe('function');
    expect(typeof structuralEntry.parseDependencyList).toBe('function');
    expect(structuralEntry.KEY_ATTRIBUTE).toBe('data-payload-key');
  });
  it('lexical', () => {
    expect(typeof lexicalEntry.lexicalToHtml).toBe('function');
    expect(typeof lexicalEntry.isLexicalContent).toBe('function');
    expect(typeof lexicalEntry.registerLexicalNode).toBe('function');
  });
  it('plugins', () => {
    expect(typeof pluginsEntry.PluginManager).toBe('function');
    expect(typeof pluginsEntry.createAnalyticsPlugin).toBe('function');
    expect(pluginsEntry.highlightPlugin).toBeDefined();
  });
});
