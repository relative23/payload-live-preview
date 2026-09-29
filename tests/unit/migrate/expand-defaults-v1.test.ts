import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrateSource } from '@migrate/index';
import { ADAPTER_ENTRIES } from '@migrate/option-literals';

const ONLY = { only: ['expand-defaults-v1'] };
const ASTRO = "import { livePreview } from 'payload-live-preview/astro';\n";
const ROOT = "import { generateInlineScript, LivePreviewClient } from 'payload-live-preview';\n";
const ADAPTER_ROWS =
  "strict: false, previewSignals: ['query', 'fetch-dest', 'referer'], disableReferrerDetection: false, " +
  "eventSourcePolicy: 'any', skipUnchanged: false, sanitizerPolicy: 'compat'";
const RUNTIME_ROWS =
  "disableReferrerDetection: false, eventSourcePolicy: 'any', skipUnchanged: false, sanitizerPolicy: 'compat'";

describe('expand-defaults-v1: the rows the profile stood for, in the source', () => {
  it.each([
    [
      'an adapter call: the request rows and the runtime rows',
      `${ASTRO}livePreview({ defaults: 'v1', allowedOrigins: [a] });\n`,
      `${ASTRO}livePreview({ ${ADAPTER_ROWS}, allowedOrigins: [a] });\n`,
    ],
    [
      'the inline generator: the runtime rows, and the depth v1 read an omitted one as',
      `${ROOT}generateInlineScript({ defaults: 'v1', serverURL: url });\n`,
      `${ROOT}generateInlineScript({ ${RUNTIME_ROWS}, mergeDepth: 1, serverURL: url });\n`,
    ],
    [
      'a client, built with new',
      `${ROOT}new LivePreviewClient({ defaults: 'v1' });\n`,
      `${ROOT}new LivePreviewClient({ ${RUNTIME_ROWS} });\n`,
    ],
    [
      'a row the options already set, which keeps its value',
      `${ASTRO}livePreview({ skipUnchanged: true, defaults: 'v1', mergeDepth: 2, serverURL: url });\n`,
      `${ASTRO}livePreview({ skipUnchanged: true, strict: false, previewSignals: ['query', 'fetch-dest', 'referer'], disableReferrerDetection: false, eventSourcePolicy: 'any', sanitizerPolicy: 'compat', mergeDepth: 2, serverURL: url });\n`,
    ],
    [
      'a shared object on its own lines, which the calls spread',
      "import { createLivePreviewMiddleware } from 'payload-live-preview/astro';\nconst COMMON = {\n  defaults: 'v1',\n  debug: true,\n} as const;\nexport const a = createLivePreviewMiddleware({ ...COMMON, fragments });\nexport const b = createLivePreviewMiddleware({ ...COMMON, routeStrategy: true });\n",
      "import { createLivePreviewMiddleware } from 'payload-live-preview/astro';\nconst COMMON = {\n  strict: false,\n  previewSignals: ['query', 'fetch-dest', 'referer'],\n  disableReferrerDetection: false,\n  eventSourcePolicy: 'any',\n  skipUnchanged: false,\n  sanitizerPolicy: 'compat',\n  debug: true,\n} as const;\nexport const a = createLivePreviewMiddleware({ ...COMMON, fragments });\nexport const b = createLivePreviewMiddleware({ ...COMMON, routeStrategy: true });\n",
    ],
  ])('%s', (_label, src, expected) => {
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(conflicts).toEqual([]);
    expect(output).toBe(expected);
    expect(migrateSource(output, ONLY).output).toBe(output);
  });
});

describe('expand-defaults-v1: what it leaves alone', () => {
  it.each([
    ["'v2'", `${ASTRO}livePreview({ defaults: 'v2' });\n`],
    ['another function', `${ASTRO}other({ defaults: 'v1' });\n`],
    ['a nested object', `${ASTRO}livePreview({ meta: { defaults: 'v1' } });\n`],
  ])('%s', (_label, src) => {
    expect(migrateSource(src, ONLY)).toEqual({ output: src, edits: [], conflicts: [] });
  });

  it.each([
    [
      'a value that is not a literal',
      `${ASTRO}livePreview({ defaults: profile });\n`,
      'not a literal',
    ],
    [
      'a spread before the key, which may set a row',
      `${ASTRO}livePreview({ ...base, defaults: 'v1' });\n`,
      'spread before',
    ],
    [
      'a caller that sets a row before spreading the shared object',
      `${ASTRO}const COMMON = { defaults: 'v1' };\nlivePreview({ skipUnchanged: true, ...COMMON });\n`,
      'before spreading',
    ],
    [
      'a caller that names its own profile',
      `${ASTRO}const COMMON = { defaults: 'v1' };\nlivePreview({ ...COMMON, defaults: 'v2' });\n`,
      'its own defaults',
    ],
    [
      'an object shared by an adapter and a client',
      "import { livePreview } from 'payload-live-preview/astro';\nimport { LivePreviewClient } from 'payload-live-preview';\nconst COMMON = { defaults: 'v1' };\nlivePreview(COMMON);\nnew LivePreviewClient(COMMON);\n",
      'adapter and a client',
    ],
  ])('reports %s and changes nothing', (_label, src, reason) => {
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(conflicts).toEqual([
      expect.objectContaining({
        codemod: 'expand-defaults-v1',
        reason: expect.stringContaining(reason) as string,
      }),
    ]);
  });

  it('reports a JSX attribute, which it does not rewrite', () => {
    const src =
      'import { LivePreviewScript } from \'payload-live-preview/nextjs\';\nexport const s = <LivePreviewScript defaults="v1" />;\n';
    const { output, conflicts } = migrateSource(src, { ...ONLY, fileName: 'layout.tsx' });
    expect(output).toBe(src);
    expect(conflicts).toEqual([
      expect.objectContaining({
        codemod: 'expand-defaults-v1',
        line: 2,
        reason: expect.stringContaining('JSX') as string,
      }),
    ]);
  });
});

describe('expand-defaults-v1: the entry decides the rows', () => {
  it('as the API reports split the options: adapter entries take the request rows, the others do not', () => {
    const adapter =
      /\b(?:PreviewAdapterOptions|LivePreview(?:Astro|Next|SvelteKit|Nuxt|Module)Options)\b/u;
    const runtime = /\b(?:LivePreviewClientConfig|InlineScriptConfig)\b/u;
    const seen: string[] = [];
    for (const file of readdirSync('etc/api')) {
      const entry = file
        .replace(/\.api\.md$/u, '')
        .split('--')
        .join('/');
      const report = readFileSync(`etc/api/${file}`, 'utf8');
      if (adapter.test(report)) {
        seen.push(entry);
        expect(ADAPTER_ENTRIES.has(entry), entry).toBe(true);
      }
      if (runtime.test(report)) expect(ADAPTER_ENTRIES.has(entry), entry).toBe(false);
    }
    expect(seen.sort()).toEqual([...ADAPTER_ENTRIES].sort());
  });
});
