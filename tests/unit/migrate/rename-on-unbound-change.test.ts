import { describe, expect, it } from 'vitest';
import { migrateSource } from '@migrate/index';

const ONLY = { only: ['rename-on-unbound-change'] };
const ASTRO = "import { createLivePreviewMiddleware } from 'payload-live-preview/astro';\n";
const ROOT = "import { initLivePreview } from 'payload-live-preview';\n";

describe('rename-on-unbound-change: what it renames', () => {
  it.each([
    [
      "'route', which is 'escalate'",
      `${ASTRO}createLivePreviewMiddleware({ debug: true, onUnboundChange: 'route' });\n`,
      `${ASTRO}createLivePreviewMiddleware({ debug: true, onUnfaithfulPatch: 'escalate' });\n`,
    ],
    [
      "'ignore', which stays 'ignore', in the quotes the file uses",
      `${ROOT}initLivePreview({ onUnboundChange: "ignore" });\n`,
      `${ROOT}initLivePreview({ onUnfaithfulPatch: "ignore" });\n`,
    ],
    [
      'a shared options object the call spreads',
      `${ASTRO}const COMMON = {\n  debug: true,\n  onUnboundChange: 'route',\n} as const;\nexport const onRequest = createLivePreviewMiddleware({ ...COMMON, routeStrategy: true });\n`,
      `${ASTRO}const COMMON = {\n  debug: true,\n  onUnfaithfulPatch: 'escalate',\n} as const;\nexport const onRequest = createLivePreviewMiddleware({ ...COMMON, routeStrategy: true });\n`,
    ],
    [
      'an options object passed by name',
      `${ROOT}const options = { onUnboundChange: 'route' };\ninitLivePreview(options);\n`,
      `${ROOT}const options = { onUnfaithfulPatch: 'escalate' };\ninitLivePreview(options);\n`,
    ],
  ])('renames %s', (_label, src, expected) => {
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(conflicts).toEqual([]);
    expect(output).toBe(expected);
    expect(migrateSource(output, ONLY).output).toBe(output);
  });
});

describe('rename-on-unbound-change: what it leaves alone', () => {
  it.each([
    ['another function', `${ROOT}other({ onUnboundChange: 'route' });\n`],
    ['a nested object', `${ROOT}initLivePreview({ meta: { onUnboundChange: 'route' } });\n`],
    [
      "a consumer's own function of the same name",
      "import { VERSION } from 'payload-live-preview';\nimport { initLivePreview } from './mine';\ninitLivePreview({ onUnboundChange: 'route' });\n",
    ],
  ])('%s', (_label, src) => {
    expect(migrateSource(src, ONLY)).toEqual({ output: src, edits: [], conflicts: [] });
  });

  it.each([
    [
      'both names',
      `${ROOT}initLivePreview({ onUnboundChange: 'route', onUnfaithfulPatch: 'warn' });\n`,
      'both onUnboundChange and onUnfaithfulPatch',
    ],
    [
      'both names across a shared object',
      `${ASTRO}const COMMON = { onUnboundChange: 'route' };\ncreateLivePreviewMiddleware({ ...COMMON, onUnfaithfulPatch: 'warn' });\n`,
      'both onUnboundChange and onUnfaithfulPatch',
    ],
    [
      'a value that is not a literal',
      `${ROOT}initLivePreview({ onUnboundChange: mode });\n`,
      'not a literal',
    ],
    [
      'the shorthand form',
      `${ROOT}const onUnboundChange = 'route';\ninitLivePreview({ onUnboundChange });\n`,
      'not a literal',
    ],
  ])('reports %s and changes nothing', (_label, src, reason) => {
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(conflicts).toEqual([
      expect.objectContaining({
        codemod: 'rename-on-unbound-change',
        reason: expect.stringContaining(reason) as string,
      }),
    ]);
  });
});
