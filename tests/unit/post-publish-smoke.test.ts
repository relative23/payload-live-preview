import { describe, expect, it } from 'vitest';
import { classifyPublishedEntries, ENTRY_REACHABILITY } from '../../scripts/post-publish-smoke';

/**
 * The smoke test only proves something about the subpaths it imports. A
 * subpath added to the package and not to the table would be published,
 * untested and unnoticed — the quiet gap this whole step exists to close.
 */
describe('published subpath classification', () => {
  it('refuses a subpath the table does not classify', () => {
    expect(() =>
      classifyPublishedEntries([...Object.keys(ENTRY_REACHABILITY), './brand-new']),
    ).toThrow(/unclassified published subpaths: \.\/brand-new/u);
  });

  it('refuses a table entry the package no longer exports', () => {
    const shrunk = Object.keys(ENTRY_REACHABILITY).filter((key) => key !== './doctor');
    expect(() => classifyPublishedEntries(shrunk)).toThrow(/no longer exports: \.\/doctor/u);
  });

  it('classifies the current surface without complaint', () => {
    const classified = classifyPublishedEntries(Object.keys(ENTRY_REACHABILITY));
    expect(classified).toHaveLength(Object.keys(ENTRY_REACHABILITY).length);
    // The two exclusions are claims, not conveniences: assert they are exactly
    // the Astro component and the virtual-module entry, so a future addition
    // cannot hide behind them.
    const skipped = classified.filter(([, kind]) => kind === 'not-node-importable').map(([e]) => e);
    expect(skipped).toEqual([
      './astro/RichText.astro',
      './astro/PreviewBoundary.astro',
      './astro/middleware-entry',
    ]);
  });
});
