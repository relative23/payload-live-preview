import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyPublishedEntries } from '../../scripts/post-publish-smoke';

const PUBLISHED = Object.keys(
  (
    JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    }
  ).exports,
);

describe('published subpath classification', () => {
  it('classifies every subpath the manifest actually exports', () => {
    const classified = classifyPublishedEntries(PUBLISHED);
    expect(classified.map(([entry]) => entry)).toEqual(PUBLISHED);
    const skipped = classified.filter(([, kind]) => kind === 'not-node-importable').map(([e]) => e);
    expect(skipped).toEqual([
      './astro/RichText.astro',
      './astro/PreviewBoundary.astro',
      './astro/middleware-entry',
    ]);
    expect(classified.filter(([, kind]) => kind === 'needs-ts-morph').map(([e]) => e)).toEqual([
      './codegen',
      './codegen/astro',
    ]);
  });

  it('refuses a subpath the table does not classify', () => {
    expect(() => classifyPublishedEntries([...PUBLISHED, './brand-new'])).toThrow(
      /unclassified published subpaths: \.\/brand-new/u,
    );
  });

  it('refuses a table entry the package no longer exports', () => {
    const shrunk = PUBLISHED.filter((key) => key !== './doctor');
    expect(() => classifyPublishedEntries(shrunk)).toThrow(/no longer exports: \.\/doctor/u);
  });
});
