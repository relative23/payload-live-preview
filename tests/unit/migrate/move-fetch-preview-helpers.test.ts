import { describe, expect, it } from 'vitest';
import { migrateSource } from '@migrate/index';

const ONLY = { only: ['move-fetch-preview-helpers'] };

describe('move-fetch-preview-helpers: rewriting', () => {
  it('splits the options between definePreview() and the read, keeps other imports, adds the server import once', () => {
    const src = [
      "import { initLivePreview, fetchPreviewDocument } from 'payload-live-preview';",
      'export async function load({ params }) {',
      '  const page = await fetchPreviewDocument({',
      '    serverURL: env.CMS_URL,',
      "    collection: 'pages',",
      '    where: { slug: { equals: params.slug } },',
      '    depth: 2,',
      '  });',
      '  return { page };',
      '}',
      '',
    ].join('\n');
    const { output, edits, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(
      [
        "import { initLivePreview } from 'payload-live-preview';",
        "import { definePreview } from 'payload-live-preview/server';",
        'export async function load({ params }) {',
        "  const page = await definePreview({ serverURL: env.CMS_URL, depth: 2 }).fetchDocument({ collection: 'pages', where: { slug: { equals: params.slug } }, authorization: null /* TODO(pll migrate): pass the verdict from authorizePreviewRequest(); null reads the published document */ });",
        '  return { page };',
        '}',
        '',
      ].join('\n'),
    );
    expect(edits.map((e) => e.codemod)).toEqual(['move-fetch-preview-helpers']);
    expect(conflicts).toEqual([
      expect.objectContaining({
        line: 3,
        reason: expect.stringContaining('PreviewFetchResult') as string,
      }),
    ]);
  });

  it('keeps type arguments, drops draft/fetchFn with a note, and adds the 1.x depth when none was set', () => {
    const src =
      "import { fetchPreviewGlobal } from 'payload-live-preview';\nconst site = await fetchPreviewGlobal<Site>({ serverURL, global: 'site', draft: true, fetchFn: myFetch });\n";
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(
      "import { definePreview } from 'payload-live-preview/server';\n" +
        "const site = await definePreview({ serverURL, depth: 1 /* TODO(pll migrate): the 1.x default; match the runtime mergeDepth */ }).fetchGlobal<Site>({ global: 'site', authorization: null /* TODO(pll migrate): pass the verdict from authorizePreviewRequest(); null reads the published document */ });\n",
    );
    expect(conflicts[0]?.reason).toContain('draft/fetchFn was dropped');
  });

  it('keeps an existing authorization and the caller-side apiRoute', () => {
    const src =
      "import { fetchPreviewDocument } from 'payload-live-preview';\nconst d = await fetchPreviewDocument({ serverURL, apiRoute: '/cms', depth: 0, collection: 'posts', id, authorization });\n";
    expect(migrateSource(src, ONLY).output).toContain(
      "definePreview({ serverURL, apiRoute: '/cms', depth: 0 }).fetchDocument({ collection: 'posts', id, authorization })",
    );
  });

  it('does not duplicate definePreview when the server entry already imports it', () => {
    const src =
      "import { fetchPreviewDocument } from 'payload-live-preview';\nimport { definePreview } from 'payload-live-preview/server';\nawait fetchPreviewDocument({ serverURL, collection: 'a', depth: 1, authorization });\n";
    const { output } = migrateSource(src, ONLY);
    expect(output.match(/import \{ definePreview \}/gu)).toHaveLength(1);
    expect(output).not.toContain('fetchPreviewDocument');
  });

  it('adds definePreview to an existing server import', () => {
    const src =
      'import { fetchPreviewDocument } from "payload-live-preview";\nimport { authorizePreviewRequest } from "payload-live-preview/server";\nawait fetchPreviewDocument({ serverURL, collection: "a", depth: 1, authorization });\n';
    const { output } = migrateSource(src, ONLY);
    expect(output.split('\n')[0]).toBe(
      'import { authorizePreviewRequest, definePreview } from "payload-live-preview/server";',
    );
    expect(output).not.toContain('from "payload-live-preview";');
  });

  it('rewrites a call through an alias', () => {
    const src =
      "import { fetchPreviewDocument as fetchDoc } from 'payload-live-preview';\nawait fetchDoc({ serverURL, collection: 'a', depth: 1, authorization });\n";
    expect(migrateSource(src, ONLY).output).toContain(
      'definePreview({ serverURL, depth: 1 }).fetchDocument(',
    );
  });
});

describe('move-fetch-preview-helpers: never leaves a call site without its import', () => {
  it.each([
    [
      'options that are a variable',
      'await fetchPreviewDocument(opts);',
      'not a plain object literal',
    ],
    [
      'options with a spread',
      'await fetchPreviewDocument({ ...base, collection: "a" });',
      'not a plain object literal',
    ],
    [
      'the function passed as a value',
      'const read = fetchPreviewDocument;',
      'other than as a direct call',
    ],
    ['no options at all', 'await fetchPreviewDocument();', 'not a plain object literal'],
  ])('reports %s and keeps the file intact', (_label, use, reason) => {
    const src = `import { fetchPreviewDocument } from 'payload-live-preview';\n${use}\n`;
    const { output, edits, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(edits).toEqual([]);
    expect(conflicts).toEqual([
      expect.objectContaining({ line: 2, reason: expect.stringContaining(reason) as string }),
    ]);
  });

  it('keeps the whole file intact when one of several calls cannot be rewritten', () => {
    const src =
      "import { fetchPreviewDocument } from 'payload-live-preview';\nawait fetchPreviewDocument({ serverURL, collection: 'a', depth: 1, authorization });\nawait fetchPreviewDocument(opts);\n";
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(conflicts.map((c) => c.line)).toEqual([3, 2]);
  });

  it('reports a require() binding and a foreign definePreview instead of rewriting', () => {
    const cjs =
      "const { fetchPreviewDocument } = require('payload-live-preview');\nfetchPreviewDocument({ serverURL, collection: 'a' });\n";
    const viaRequire = migrateSource(cjs, { ...ONLY, fileName: 'x.cjs' });
    expect(viaRequire.output).toBe(cjs);
    expect(viaRequire.conflicts[0]?.reason).toContain('require()');

    const foreign =
      "import { fetchPreviewDocument } from 'payload-live-preview';\nimport { definePreview } from './mine';\nawait fetchPreviewDocument({ serverURL, collection: 'a', depth: 1, authorization });\n";
    const viaForeign = migrateSource(foreign, ONLY);
    expect(viaForeign.output).toBe(foreign);
    expect(
      viaForeign.conflicts.some((c) => c.reason.includes('already binds a definePreview')),
    ).toBe(true);
  });
});
