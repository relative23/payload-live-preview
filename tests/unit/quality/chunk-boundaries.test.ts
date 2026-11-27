import { describe, expect, it } from 'vitest';
import { chunkBoundaries, definingModules } from '../../../scripts/chunk-boundaries';
import { CLI_ENTRIES, DIRECTIVE_ENTRIES, LIBRARY_ENTRIES } from '../../../scripts/package-entries';

/**
 * The build draws a chunk boundary around every module that defines a name
 * the root exports, so that a bundler which takes a file whole ships the
 * feature a project imports and not its neighbours (ADR 0007, row 46). The
 * list is read off the entries; these cases hold the reading.
 */
describe('the modules that define what an entry exports', () => {
  const browser = definingModules('src/client-entry.ts');

  it('follows a barrel to the module behind each name it takes', () => {
    expect(browser).toEqual(
      expect.arrayContaining([
        'src/client/live-preview-client.ts',
        'src/plugins/manager.ts',
        'src/plugins/built-in/highlight.ts',
        'src/plugins/built-in/unbound-fields-overlay.ts',
        'src/core/bindings/morph.ts',
        'src/adapters/shared/document-session.ts',
        'src/security/escape.ts',
      ]),
    );
  });

  it('names no barrel, no module of types alone and no module whose names the entry leaves', () => {
    // The plugin barrel, the types `export type` takes, and what the detection barrel
    // exports beside `OriginDetector`.
    expect(browser).not.toContain('src/plugins/index.ts');
    expect(browser).not.toContain('src/core/types.ts');
    expect(browser).not.toContain('src/detection/environment.ts');
  });

  it('reads the root as the browser entry and what a server needs beside it', () => {
    const root = definingModules('src/index.ts');

    expect(root).toEqual(expect.arrayContaining([...browser]));
    expect(root.filter((module) => !browser.includes(module))).toEqual([
      'src/adapters/shared/locals.ts',
      'src/adapters/shared/preview-request.ts',
      'src/dsl/bind.ts',
      'src/dsl/preview-bindings.ts',
      'src/inline/generator.ts',
      'src/security/csp.ts',
      'src/security/preview-authorization.ts',
    ]);
  });
});

describe('the boundary entries of the build', () => {
  it('are named by their module under one folder, which no real entry uses', () => {
    const boundaries = chunkBoundaries();

    expect(boundaries['boundary/plugins/manager']).toBe('src/plugins/manager.ts');
    expect(Object.keys(boundaries).every((name) => name.startsWith('boundary/'))).toBe(true);
    expect(
      Object.keys({ ...LIBRARY_ENTRIES, ...CLI_ENTRIES, ...DIRECTIVE_ENTRIES }).filter((name) =>
        name.startsWith('boundary/'),
      ),
    ).toEqual([]);
  });
});
