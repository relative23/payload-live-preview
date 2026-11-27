/**
 * The guides quote the runtime's transfer size and the bytes each delivery path charges a visitor. Each
 * claim is held to the number that decides it, so these cases pin the wording the check reads and show
 * that a stale number, in each phrase the docs use today, is reported with its file and line.
 */
import { describe, expect, it } from 'vitest';
import {
  deliveryClaims,
  deliveryClaimViolations,
  deliveryFamilies,
  deliveryOverhead,
  importCeilingViolations,
  sizeClaimViolations,
  type DeliveryFacts,
  type ImportCeiling,
} from '../../../scripts/docs-size-claims';

const FULL = 45_515;
const facts: DeliveryFacts = {
  runtime: 144_576,
  nextBootstrap: 1_344,
  astroLoader: 792,
  astroInline: 156,
  nextAuthorized: 14_309,
};
const expectedFor = (family: string): number => {
  const found = deliveryFamilies(facts).find(([name]) => name === family);
  if (found === undefined) throw new Error(`no family ${family}`);
  return found[2];
};
const violations = (text: string): string[] =>
  deliveryClaimViolations(deliveryClaims(text, facts), 'docs/x.md');

describe('the gzip size claims', () => {
  it.each([
    ['the default script, in KB', 'costs about 44 KB gzip on every page', 0],
    ['the default script, in KiB', 'every visitor downloads about 44 KiB gzip with it', 0],
    ['the default script, a kilobyte off', 'about 43 KB gzip', 0],
    ['the default script, stale', 'costs about 42 KB gzip on every page that carries it', 1],
    ['no figure', 'nothing here', 0],
  ])('%s', (_case, text, count) => {
    expect(sizeClaimViolations(text, 'docs/x.md', FULL)).toHaveLength(count);
  });

  it('says which artifact, where and by how much', () => {
    expect(sizeClaimViolations('\n\nabout 42 KB gzip', 'docs/html.md', FULL)).toEqual([
      'docs/html.md:3 says 42 KB gzip for the default inline script, the budget is 44 KB',
    ]);
  });
});

describe('the delivery byte claims', () => {
  // family, a sentence in today's wording, the number it carries, the number it carried one release earlier
  const wording: [string, string, string, string][] = [
    [
      'runtime artifact',
      'plus the current 144 576-byte runtime artifact in the two rows',
      '144 576',
      '144 476',
    ],
    [
      'Astro inline row',
      "| Astro static build, `mode: 'inline'`     | the whole runtime | 144 732 | nothing decides |",
      '144 732',
      '144 632',
    ],
    [
      'authorized Next.js row',
      '| Next.js, `await LivePreviewScript(…)` for an authorized editor | the whole runtime | 158 885, twice | why |',
      '158 885',
      '158 609',
    ],
    [
      'authorized Next.js total',
      'against 158 885 bytes for authorized inline delivery',
      '158 885',
      '158 609',
    ],
    [
      'Next.js bootstrap on the example',
      'that carries the options (1 344 bytes on the\nexample, 1 364 with the options below',
      '1 344',
      '1 367',
    ],
    [
      'Next.js bootstrap in the guide',
      "Next.js fixture's delivery is a 1 344-byte `<script>`",
      '1 344',
      '1 367',
    ],
    [
      'Next.js bootstrap in the options',
      'is 1 344 bytes\n  in its direct script element',
      '1 344',
      '1 367',
    ],
    [
      'Next.js bootstrap row',
      "| Next.js, `delivery: 'asset'`  | the bootstrap | 1 344, twice | why |",
      '1 344',
      '1 367',
    ],
    [
      'Astro loader row',
      "| Astro static build, `mode: 'loader'` | the bootstrap | 792 | a static page |",
      '792',
      '772',
    ],
    ['Astro loader floor', '792 bytes is the floor of this table', '792', '772'],
  ];

  it('knows every family it reads', () => {
    expect(
      deliveryFamilies(facts)
        .map(([family]) => family)
        .sort(),
    ).toEqual(wording.map(([family]) => family).sort());
  });

  it.each(wording)('accepts the current %s', (family, text) => {
    expect(deliveryClaims(text, facts).map((claim) => claim.family)).toEqual([family]);
    expect(violations(text)).toEqual([]);
  });

  it.each(wording)('reports a stale %s with its file and line', (family, text, now, before) => {
    const stale = `\n${text.replace(now, before)}`;
    expect(violations(stale)).toEqual([
      `docs/x.md:2 says ${before.replaceAll(' ', '')} bytes for the ${family}, the code says ${expectedFor(family)}`,
    ]);
  });

  it('does not read a number the phrases do not name', () => {
    expect(violations('a 116 413-byte `<script>` element in a 258 227-byte response')).toEqual([]);
  });
});

describe('the pinned overheads', () => {
  const source = [
    "    name: 'Astro, static build, mode: loader',",
    '    overheadBytes: 792,',
    "    name: 'Next.js, delivery: asset',",
    '    overheadBytes: 1_344,',
  ].join('\n');

  it('reads the overhead of the named row', () => {
    expect(deliveryOverhead(source, 'Astro, static build, mode: loader')).toBe(792);
    expect(deliveryOverhead(source, 'Next.js, delivery: asset')).toBe(1344);
  });

  it('refuses a row that is not there', () => {
    expect(() => deliveryOverhead(source, 'Nuxt, nothing')).toThrow(/no overheadBytes/u);
  });
});

describe('the one-import ceilings of the benchmarks page', () => {
  const CEILINGS: readonly ImportCeiling[] = [
    { symbol: 'escapeHtml', from: 'payload-live-preview', bytes: 223 },
    { symbol: 'initLivePreview', from: 'payload-live-preview/client', bytes: 53_323 },
    { symbol: 'escapeHtml', bytes: 576 },
  ];
  const TABLES = [
    '| Consumer imports                                     | gzip ceiling |',
    '| ---------------------------------------------------- | ------------ |',
    '| `escapeHtml` from `payload-live-preview`             | 223 B        |',
    '| `initLivePreview` from `payload-live-preview/client` | 53,323 B     |',
    '',
    '| A project takes from `payload-live-preview/client` | raw ceiling |',
    '| -------------------------------------------------- | ----------- |',
    '| `escapeHtml`                                       | 576 B       |',
  ].join('\n');

  it('accepts the tables that state every ceiling as the budget has it', () => {
    expect(importCeilingViolations(TABLES, 'docs/benchmarks.md', CEILINGS)).toEqual([]);
  });

  it('reports a stale number with its line, and tells the two tables apart by the entry', () => {
    const stale = TABLES.replace('53,323 B', '53,304 B').replace('576 B ', '572 B ');

    expect(importCeilingViolations(stale, 'docs/benchmarks.md', CEILINGS)).toEqual([
      'docs/benchmarks.md:4 says 53304 B for initLivePreview from payload-live-preview/client, the budget is 53323',
      'docs/benchmarks.md:8 says 572 B for escapeHtml, the budget is 576',
    ]);
  });

  it('reports a ceiling without a row and a row without a ceiling', () => {
    const moved = TABLES.replace(
      'payload-live-preview/client` |',
      'payload-live-preview/core`   |',
    );

    expect(importCeilingViolations(moved, 'docs/benchmarks.md', CEILINGS)).toEqual([
      'docs/benchmarks.md:4 has a row for initLivePreview from payload-live-preview/core, which the gate does not measure',
      'docs/benchmarks.md has no row for initLivePreview from payload-live-preview/client, which the tree-shaking gate measures',
    ]);
  });
});
