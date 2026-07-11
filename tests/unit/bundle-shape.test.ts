/**
 * Bundle-shape sanity tests.
 *
 * These tests don't probe behaviour — they assert the *shape* of the
 * narrow `core` entry. The goal is to catch accidental coupling: if
 * someone re-exports the inline-runtime generator or a plugin from
 * `core-entry.ts`, the bundle ratio collapses and these tests fire.
 */

import { describe, expect, it } from 'vitest';
import * as fullEntry from '../../src/index';
import * as coreEntry from '../../src/core-entry';

describe('bundle shape — `core` entry', () => {
  it('exports the lean live-preview surface', () => {
    expect(coreEntry.LivePreviewClient).toBeTypeOf('function');
    expect(coreEntry.initLivePreview).toBeTypeOf('function');
    expect(coreEntry.OriginDetector).toBeTypeOf('function');
    expect(coreEntry.EventEmitter).toBeTypeOf('function');
    expect(coreEntry.sanitizeHtml).toBeTypeOf('function');
    expect(coreEntry.generateCspNonce).toBeTypeOf('function');
    expect(coreEntry.LIBRARY_PROTOCOL_VERSION).toBeTypeOf('number');
  });

  it('OMITS the heavyweight optional pieces', () => {
    const exportNames = Object.keys(coreEntry);
    expect(exportNames).not.toContain('lexicalToHtml');
    expect(exportNames).not.toContain('lexicalToPlainText');
    expect(exportNames).not.toContain('highlightPlugin');
    expect(exportNames).not.toContain('debugPlugin');
    expect(exportNames).not.toContain('createAnalyticsPlugin');
    expect(exportNames).not.toContain('generateInlineScript');
    expect(exportNames).not.toContain('wrapWithScriptTag');
  });

  it('shares the same VERSION as the full entry', () => {
    expect(coreEntry.VERSION).toBe(fullEntry.VERSION);
  });

  it('marks itself with a CORE_ENTRY flag the full entry does not have', () => {
    expect(coreEntry.CORE_ENTRY).toBe(true);
    expect((fullEntry as Record<string, unknown>)['CORE_ENTRY']).toBeUndefined();
  });
});

describe('bundle shape — `full` entry', () => {
  it('exports Lexical and plugin helpers', () => {
    expect(fullEntry.lexicalToHtml).toBeTypeOf('function');
    expect(fullEntry.highlightPlugin).toBeTypeOf('object');
    expect(fullEntry.debugPlugin).toBeTypeOf('object');
    expect(fullEntry.generateInlineScript).toBeTypeOf('function');
  });
});
