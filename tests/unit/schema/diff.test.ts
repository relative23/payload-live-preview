import { describe, expect, it } from 'vitest';
import { diffArray, type ArrayPatch } from '@schema/diff';

describe('diffArray — id-keyed', () => {
  it('returns no patches for identical inputs', () => {
    const a = [
      { id: 1, x: 'a' },
      { id: 2, x: 'b' },
    ];
    const b = [
      { id: 1, x: 'a' },
      { id: 2, x: 'b' },
    ];
    expect(diffArray(a, b)).toEqual([]);
  });

  it('detects inserts', () => {
    const prev = [{ id: 1, x: 'a' }];
    const next = [
      { id: 1, x: 'a' },
      { id: 2, x: 'b' },
    ];
    const patches = diffArray(prev, next);
    expect(patches).toContainEqual({ kind: 'insert', index: 1, value: { id: 2, x: 'b' } });
  });

  it('detects removes', () => {
    const prev = [
      { id: 1, x: 'a' },
      { id: 2, x: 'b' },
    ];
    const next = [{ id: 1, x: 'a' }];
    const patches = diffArray(prev, next);
    expect(patches).toContainEqual({ kind: 'remove', index: 1, value: { id: 2, x: 'b' } });
  });

  it('detects moves', () => {
    const prev = [
      { id: 1, x: 'a' },
      { id: 2, x: 'b' },
    ];
    const next = [
      { id: 2, x: 'b' },
      { id: 1, x: 'a' },
    ];
    const patches = diffArray(prev, next);
    const move = patches.find((p): p is Extract<ArrayPatch, { kind: 'move' }> => p.kind === 'move');
    expect(move).toBeDefined();
  });

  it('detects updates to existing items', () => {
    const prev = [{ id: 1, x: 'a' }];
    const next = [{ id: 1, x: 'b' }];
    const patches = diffArray(prev, next);
    expect(patches).toContainEqual({ kind: 'update', index: 0, value: { id: 1, x: 'b' } });
  });

  it('detects block-type replacements', () => {
    const prev = [{ id: 1, blockType: 'callout', text: 'old' }];
    const next = [{ id: 1, blockType: 'image', src: 'a.jpg' }];
    const patches = diffArray(prev, next);
    expect(patches).toContainEqual({
      kind: 'replace',
      index: 0,
      oldValue: prev[0],
      value: next[0],
    });
  });

  it('treats items without id in the new list as inserts', () => {
    const prev = [{ id: 1, x: 'a' }];
    const next = [{ id: 1, x: 'a' }, { x: 'b' }];
    const patches = diffArray(prev, next);
    const inserts = patches.filter((p) => p.kind === 'insert');
    // Positional path applies: 2 items in next, 1 in prev → 1 insert; the
    // mixed-id case forces position diff. Either way the second item is an insert.
    expect(inserts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('diffArray — positional fallback', () => {
  it('falls back to positional diff when ids are missing', () => {
    const prev = [{ x: 'a' }, { x: 'b' }];
    const next = [{ x: 'a' }, { x: 'c' }];
    const patches = diffArray(prev, next);
    expect(patches).toContainEqual({ kind: 'update', index: 1, value: { x: 'c' } });
  });

  it('detects positional inserts', () => {
    const prev = [{ x: 'a' }];
    const next = [{ x: 'a' }, { x: 'b' }];
    const patches = diffArray(prev, next);
    expect(patches).toContainEqual({ kind: 'insert', index: 1, value: { x: 'b' } });
  });

  it('detects positional removes', () => {
    const prev = [{ x: 'a' }, { x: 'b' }];
    const next = [{ x: 'a' }];
    const patches = diffArray(prev, next);
    expect(patches).toContainEqual({ kind: 'remove', index: 1, value: { x: 'b' } });
  });

  it('returns no patches for two identical positional arrays', () => {
    const prev = [{ x: 'a' }];
    const next = [{ x: 'a' }];
    expect(diffArray(prev, next)).toEqual([]);
  });
});

describe('diffArray — edge cases', () => {
  it('handles primitive arrays positionally', () => {
    const patches = diffArray(['a', 'b'], ['a', 'c']);
    expect(patches).toContainEqual({ kind: 'update', index: 1, value: 'c' });
  });

  it('handles empty prev', () => {
    const patches = diffArray([], [{ id: 1 }]);
    expect(patches).toContainEqual({ kind: 'insert', index: 0, value: { id: 1 } });
  });

  it('handles empty next', () => {
    const patches = diffArray([{ id: 1 }], []);
    expect(patches).toContainEqual({ kind: 'remove', index: 0, value: { id: 1 } });
  });

  it('shallowEqual handles nested-object items by emitting update', () => {
    const prev = [{ id: 1, nested: { count: 1 } }];
    const next = [{ id: 1, nested: { count: 2 } }];
    const patches = diffArray(prev, next);
    expect(patches.some((p) => p.kind === 'update')).toBe(true);
  });
});
