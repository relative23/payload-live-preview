import { describe, expect, it } from 'vitest';
import { CODEMODS, importsThisPackage, migrateSource } from '@migrate/index';

const EVERYTHING = [
  "import { isPreviewRequest, createPreviewBindings, fetchPreviewGlobal } from 'payload-live-preview';",
  'export async function load({ request }) {',
  '  const preview = isPreviewRequest(request);',
  '  const bindings = createPreviewBindings({ authorized: preview });',
  "  const site = await fetchPreviewGlobal({ serverURL: env.CMS, global: 'site', depth: 1, authorization });",
  '  return { site, bindings };',
  '}',
  '',
].join('\n');

describe('importsThisPackage', () => {
  it.each([
    ["import { x } from 'payload-live-preview';", true],
    ['import { x } from "payload-live-preview/server";', true],
    ["import 'payload-live-preview';", true],
    ["const { x } = require('payload-live-preview');", true],
    ["const mod = await import('payload-live-preview/client');", true],
    ["export { x } from 'payload-live-preview';", true],
    ["import { x } from 'payload-live-preview-extras';", false],
    ["import { x } from '@payloadcms/live-preview';", false],
    ["const name = 'payload-live-preview';", false],
  ])('%s → %s', (source, expected) => {
    expect(importsThisPackage(source)).toBe(expected);
  });
});

describe('migrateSource', () => {
  it('runs every codemod in order and is idempotent', () => {
    const once = migrateSource(EVERYTHING);
    expect(once.edits.map((e) => e.codemod)).toEqual(CODEMODS.map((c) => c.id));
    expect(once.output).toContain('hasPreviewIntent(request)');
    expect(once.output).toContain('authorization: preview');
    expect(once.output).toContain(
      "definePreview({ serverURL: env.CMS, depth: 1 }).fetchGlobal({ global: 'site', authorization })",
    );
    const twice = migrateSource(once.output);
    expect(twice.output).toBe(once.output);
    expect(twice.edits).toEqual([]);
    expect(twice.conflicts).toEqual([]);
  });

  it('touches only the frontmatter and script blocks of an Astro component and keeps line numbers file-relative', () => {
    const src = [
      '---',
      "import { isPreviewRequest } from 'payload-live-preview';",
      'const preview = isPreviewRequest(Astro.request);',
      'const api = { isPreviewRequest };',
      '---',
      '<h1 data-payload-field="title">{title}</h1>',
      '<p>isPreviewRequest is not code here</p>',
      '<script>',
      "  import { isPreviewRequest } from 'payload-live-preview';",
      '  console.log(isPreviewRequest(new Request(location.href)));',
      '</script>',
      '',
    ].join('\n');
    const { output, conflicts } = migrateSource(src, { fileName: 'src/pages/index.astro' });
    const lines = output.split('\n');
    expect(lines[1]).toBe("import { isPreviewRequest } from 'payload-live-preview';");
    expect(lines[6]).toBe('<p>isPreviewRequest is not code here</p>');
    expect(lines[8]).toBe("  import { hasPreviewIntent } from 'payload-live-preview';");
    expect(lines[9]).toBe('  console.log(hasPreviewIntent(new Request(location.href)));');
    expect(conflicts).toEqual([expect.objectContaining({ line: 4 })]);
  });

  it('handles Svelte and Vue script blocks and leaves the template alone', () => {
    const svelte =
      '<script lang="ts">\n  import { isPreviewRequest } from \'payload-live-preview\';\n  export let data;\n  const p = isPreviewRequest(data.request);\n</script>\n\n<h1>{p ? "preview" : "public"}</h1>\n';
    const migrated = migrateSource(svelte, { fileName: 'Page.svelte' }).output;
    expect(migrated).toContain("import { hasPreviewIntent } from 'payload-live-preview';");
    expect(migrated).toContain('const p = hasPreviewIntent(data.request);');
    expect(migrated).toContain('<h1>{p ? "preview" : "public"}</h1>');

    const vue =
      '<template><div>{{ p }}</div></template>\n<script setup lang="ts">\nimport { isPreviewRequest } from "payload-live-preview";\nconst p = isPreviewRequest(useRequest());\n</script>\n';
    expect(migrateSource(vue, { fileName: 'Page.vue' }).output).toContain(
      'const p = hasPreviewIntent(useRequest());',
    );
  });

  it('parses JSX in .tsx and .jsx files', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\nexport const Flag = ({ req }) => <span data-preview={isPreviewRequest(req)}>x</span>;\n";
    expect(migrateSource(src, { fileName: 'Flag.tsx' }).output).toContain(
      'data-preview={hasPreviewIntent(req)}',
    );
    expect(migrateSource(src, { fileName: 'Flag.jsx' }).output).toContain(
      'data-preview={hasPreviewIntent(req)}',
    );
  });

  it('skips parsing entirely when the package is not mentioned', () => {
    const src = 'function isPreviewRequest(r) { return false; }\nisPreviewRequest(req);\n';
    expect(migrateSource(src)).toEqual({ output: src, edits: [], conflicts: [] });
  });

  it('every codemod names a real ledger entry', () => {
    for (const codemod of CODEMODS) {
      expect(codemod.ledgerEntry).toBeGreaterThanOrEqual(1);
      expect(codemod.ledgerEntry).toBeLessThanOrEqual(12);
      expect(codemod.summary.length).toBeGreaterThan(10);
    }
  });
});
