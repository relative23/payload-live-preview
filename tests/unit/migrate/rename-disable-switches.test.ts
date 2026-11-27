import { describe, expect, it } from 'vitest';
import { migrateSource } from '@migrate/index';

const ONLY = { only: ['rename-disable-switches'] };
const ASTRO = "import { createLivePreviewMiddleware } from 'payload-live-preview/astro';\n";
const ROOT = "import { initLivePreview } from 'payload-live-preview';\n";
const CLIENT = "import { LivePreviewClient } from 'payload-live-preview/client';\n";

describe('rename-disable-switches: what it renames', () => {
  it.each([
    [
      'the gate switched off, which is the gate not enabled',
      `${ASTRO}createLivePreviewMiddleware({ debug: true, disableVisibilityGate: true });\n`,
      `${ASTRO}createLivePreviewMiddleware({ debug: true, enableVisibilityGate: false });\n`,
    ],
    [
      'referrer trust asked for by not disabling it',
      `${ROOT}initLivePreview({ disableReferrerDetection: false });\n`,
      `${ROOT}initLivePreview({ enableReferrerDetection: true });\n`,
    ],
    [
      'all three in one literal, each on its own value',
      `${CLIENT}new LivePreviewClient({\n  disableVisibilityGate: false,\n  disableReferrerDetection: true,\n  disableLocalhostMatching: true,\n});\n`,
      `${CLIENT}new LivePreviewClient({\n  enableVisibilityGate: true,\n  enableReferrerDetection: false,\n  enableLocalhostMatching: false,\n});\n`,
    ],
    [
      'a shared options object the call spreads',
      `${ASTRO}const COMMON = {\n  disableLocalhostMatching: true,\n} as const;\nexport const onRequest = createLivePreviewMiddleware({ ...COMMON, routeStrategy: true });\n`,
      `${ASTRO}const COMMON = {\n  enableLocalhostMatching: false,\n} as const;\nexport const onRequest = createLivePreviewMiddleware({ ...COMMON, routeStrategy: true });\n`,
    ],
    [
      'an options object passed by name',
      `${ROOT}const options = { disableVisibilityGate: true };\ninitLivePreview(options);\n`,
      `${ROOT}const options = { enableVisibilityGate: false };\ninitLivePreview(options);\n`,
    ],
  ])('renames %s', (_label, src, expected) => {
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(conflicts).toEqual([]);
    expect(output).toBe(expected);
    expect(migrateSource(output, ONLY).output).toBe(output);
  });
});

describe('rename-disable-switches: what it leaves alone', () => {
  it.each([
    ['another function', `${ROOT}other({ disableVisibilityGate: true });\n`],
    ['a nested object', `${ROOT}initLivePreview({ meta: { disableVisibilityGate: true } });\n`],
    ['the new names', `${ROOT}initLivePreview({ enableVisibilityGate: false });\n`],
    [
      "a consumer's own function of the same name",
      "import { VERSION } from 'payload-live-preview';\nimport { initLivePreview } from './mine';\ninitLivePreview({ disableVisibilityGate: true });\n",
    ],
  ])('%s', (_label, src) => {
    expect(migrateSource(src, ONLY)).toEqual({ output: src, edits: [], conflicts: [] });
  });

  // A value that may be `undefined` meant the default under the old name; negated it would read as "on".
  it.each([
    [
      'both names',
      `${ROOT}initLivePreview({ disableVisibilityGate: true, enableVisibilityGate: true });\n`,
      2,
      'both disableVisibilityGate and enableVisibilityGate are given; 3.0 refuses disableVisibilityGate, drop it by hand',
    ],
    [
      'both names across a shared object',
      `${ASTRO}const COMMON = { disableReferrerDetection: false };\ncreateLivePreviewMiddleware({ ...COMMON, enableReferrerDetection: true });\n`,
      2,
      'both disableReferrerDetection and enableReferrerDetection are given; 3.0 refuses disableReferrerDetection, drop it by hand',
    ],
    [
      'a value that is not a literal',
      `${ROOT}initLivePreview({ disableReferrerDetection: trusted });\n`,
      2,
      'disableReferrerDetection is not a literal true or false; rename it to enableReferrerDetection by hand, with the value turned round',
    ],
    [
      'the shorthand form',
      `${ROOT}const disableLocalhostMatching = true;\ninitLivePreview({ disableLocalhostMatching });\n`,
      3,
      'disableLocalhostMatching is not a literal true or false; rename it to enableLocalhostMatching by hand, with the value turned round',
    ],
  ])('reports %s and changes nothing', (_label, src, line, reason) => {
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(conflicts).toEqual([{ codemod: 'rename-disable-switches', line, reason }]);
  });

  it('reports a JSX attribute, which it cannot turn round', () => {
    const src =
      "import { LivePreviewScript } from 'payload-live-preview/nextjs';\n" +
      'export const head = <LivePreviewScript disableVisibilityGate />;\n';
    const { output, conflicts } = migrateSource(src, { ...ONLY, fileName: 'layout.tsx' });
    expect(output).toBe(src);
    expect(conflicts).toEqual([
      {
        codemod: 'rename-disable-switches',
        line: 2,
        reason:
          'a JSX attribute; rename it to enableVisibilityGate by hand, with the value turned round',
      },
    ]);
  });
});
