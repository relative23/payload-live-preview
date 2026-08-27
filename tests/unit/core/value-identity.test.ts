import { describe, expect, it } from 'vitest';
import { IDENTITY_SIZE_LIMIT, valueIdentity } from '@core/value-identity';

/**
 * The identity decides whether a binding is re-rendered. Two errors are
 * possible and they are not symmetric: calling two different values equal
 * leaves a stale binding on the page, calling two equal values different
 * merely renders once more. Every case here is chosen with that asymmetry in
 * mind — "different" must be provably different, "equal" must be exactly the
 * wire-level meaning.
 */
describe('valueIdentity — values that must differ', () => {
  it('keeps primitive types apart even when a renderer would print them alike', () => {
    expect(valueIdentity(1)).not.toBe(valueIdentity('1'));
    expect(valueIdentity(true)).not.toBe(valueIdentity('true'));
    expect(valueIdentity(null)).not.toBe(valueIdentity(undefined));
    expect(valueIdentity(null)).not.toBe(valueIdentity(''));
    expect(valueIdentity(0)).not.toBe(valueIdentity(false));
  });

  it('follows Object.is for the numbers JSON gets wrong', () => {
    expect(valueIdentity(0)).not.toBe(valueIdentity(-0));
    expect(valueIdentity(Number.NaN)).toBe(valueIdentity(Number.NaN));
  });

  it('treats array order as meaning', () => {
    expect(valueIdentity([1, 2])).not.toBe(valueIdentity([2, 1]));
  });

  it('distinguishes an object from its serialised string', () => {
    expect(valueIdentity({ a: 1 })).not.toBe(valueIdentity('{"a":1}'));
  });
});

describe('valueIdentity — values that must be equal', () => {
  it('is plain JSON: the same document in the same key order is one value', () => {
    expect(valueIdentity({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      valueIdentity({ a: 1, b: [1, { c: 2, d: 3 }] }),
    );
  });

  it('gives a fresh object graph the same identity as the last one', () => {
    // Payload allocates a new object per message; reference identity would
    // never match a rich-text value and the optimisation would skip nothing.
    const make = (): unknown => ({
      root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'hi' }] }] },
    });
    expect(valueIdentity(make())).toBe(valueIdentity(make()));
  });

  it('drops undefined-valued properties the way JSON does', () => {
    expect(valueIdentity({ a: 1, b: undefined })).toBe(valueIdentity({ a: 1 }));
    // …but inside an array undefined becomes null, also as JSON does.
    expect(valueIdentity([undefined])).toBe(valueIdentity([null]));
  });
});

describe('valueIdentity — the safe direction', () => {
  it('treats a reordered object as changed rather than paying to sort keys', () => {
    // Sorting keys measured six times the cost of rendering a small Lexical
    // document. A reorder is therefore a re-render, never a skipped one.
    expect(valueIdentity({ a: 1, b: 2 })).not.toBe(valueIdentity({ b: 2, a: 1 }));
  });
});

describe('valueIdentity — values it declines to compare', () => {
  it('returns undefined for a cycle rather than hanging or throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(valueIdentity(cyclic)).toBeUndefined();
  });

  it('returns undefined for shapes JSON refuses, and follows JSON where it is lenient', () => {
    // A nested BigInt makes JSON.stringify throw: no identity, treated as changed.
    expect(valueIdentity({ big: 1n })).toBeUndefined();
    // A top-level function or symbol is not a value at all.
    expect(valueIdentity(() => 1)).toBeUndefined();
    expect(valueIdentity(Symbol('x'))).toBeUndefined();
    // Inside an object JSON silently drops functions and symbols. That is the
    // wire's meaning — such a value cannot arrive from Payload — so the
    // identity follows it rather than inventing a stricter rule.
    expect(valueIdentity({ f: () => 1 })).toBe(valueIdentity({}));
    expect(valueIdentity({ s: Symbol('x') })).toBe(valueIdentity({}));
  });

  it('gives a top-level bigint an identity but never confuses it with a number', () => {
    expect(valueIdentity(1n)).toBeDefined();
    expect(valueIdentity(1n)).not.toBe(valueIdentity(1));
  });

  it('returns undefined past the size limit, on both the string and object paths', () => {
    const big = 'x'.repeat(IDENTITY_SIZE_LIMIT + 1);
    expect(valueIdentity(big)).toBeUndefined();
    expect(valueIdentity({ big })).toBeUndefined();
    // Exactly at the limit is still comparable: the bound is "not obviously
    // cheaper than a render", not a hard cap on correctness.
    expect(valueIdentity('x'.repeat(IDENTITY_SIZE_LIMIT))).toBeDefined();
  });

  it('leaves a shared, non-cyclic subtree comparable', () => {
    // The cycle detector must track the current path, not everything seen:
    // the same object reached twice by different paths is not a cycle.
    const shared = { k: 1 };
    expect(valueIdentity({ a: shared, b: shared })).toBe(
      valueIdentity({ a: { k: 1 }, b: { k: 1 } }),
    );
  });
});
