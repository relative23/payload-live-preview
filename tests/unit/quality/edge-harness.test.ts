import { describe, expect, it } from 'vitest';
import { ownChunk } from '../../../scripts/edge-harness';

/**
 * The edge check loads a built entry into a context that has the Web
 * platform's globals and nothing else. Since the entries share chunks it
 * follows an import of the package's own files, and of nothing else: a bare
 * specifier or a Node builtin is what an edge runtime does not have.
 */
describe('what a built entry may import in the edge check', () => {
  const DIST = '/repo/dist';

  it("follows the package's own chunks, from an entry at any depth", () => {
    expect(ownChunk(DIST, '/repo/dist/server.js', './chunk-ABCD.js')).toBe(
      '/repo/dist/chunk-ABCD.js',
    );
    expect(ownChunk(DIST, '/repo/dist/adapters/nextjs/index.js', '../../chunk-ABCD.js')).toBe(
      '/repo/dist/chunk-ABCD.js',
    );
  });

  it.each([
    ['a Node builtin', 'node:fs'],
    ['a bare specifier', 'react'],
    ['a path that leaves dist', '../src/index.js'],
    ['an absolute path', '/etc/passwd'],
    ['dist itself', '.'],
  ])('refuses %s', (_label, specifier) => {
    expect(ownChunk(DIST, '/repo/dist/server.js', specifier)).toBeUndefined();
  });
});
