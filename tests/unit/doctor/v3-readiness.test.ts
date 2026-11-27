import { describe, expect, it } from 'vitest';
import { formatV3Readiness, runV3Readiness, type V3Report } from '@doctor/v3-readiness';

/** A project held in memory; a path that is not in it cannot be read. */
function project(files: Record<string, string>) {
  return {
    list: () => Promise.resolve(Object.keys(files)),
    read: (path: string) => {
      const text = files[path];
      return text === undefined
        ? Promise.reject(new Error(`ENOENT ${path}`))
        : Promise.resolve(text);
    },
  };
}

const check = (files: Record<string, string>): Promise<V3Report> =>
  runV3Readiness('src', { io: project(files) });

/** The places of one rule, as `file:line`. */
function places(report: V3Report, rule: string): string[] {
  const row = report.rows.find((candidate) => candidate.rule.id === rule);
  return (row?.places ?? []).map((place) => `${place.file}:${String(place.line)}`);
}

const rules = (report: V3Report): string[] => report.rows.map((row) => row.rule.id);

describe('pll doctor --v3: hooks (rows 26, 27 and 31)', () => {
  it('lists a hook that names no document and sets no deadline', async () => {
    const report = await check({
      'src/Page.tsx': [
        "import { useLivePreviewDocument } from 'payload-live-preview/react';",
        'export function Page({ initial }) {',
        "  return useLivePreviewDocument({ initialData: initial, serverURL: 'https://cms.example.com' });",
        '}',
      ].join('\n'),
    });

    expect(places(report, 'hook-document')).toEqual(['Page.tsx:3']);
    expect(places(report, 'merge-deadline')).toEqual(['Page.tsx:3']);
    expect(report.unread).toEqual([]);
  });

  it('leaves a hook alone that names its document and its deadline', async () => {
    const report = await check({
      'src/Page.vue': [
        '<script setup lang="ts">',
        "import { useLivePreviewDocument } from 'payload-live-preview/vue';",
        'const state = useLivePreviewDocument({',
        '  initialData: props.post,',
        "  serverURL: 'https://cms.example.com',",
        "  document: { collection: 'posts', id: props.post.id },",
        '  timeoutMs: 10_000,',
        '});',
        '</script>',
      ].join('\n'),
    });

    expect(report.rows).toEqual([]);
  });

  it('reads the session factory, whose options are the second argument', async () => {
    const report = await check({
      'src/session.ts': [
        "import { createDocumentSession } from 'payload-live-preview/core';",
        "export const session = createDocumentSession(initial, { serverURL: 'https://cms.example.com' });",
      ].join('\n'),
    });

    expect(places(report, 'hook-document')).toEqual(['session.ts:2']);
    expect(places(report, 'merge-deadline')).toEqual(['session.ts:2']);
  });

  it('lists a hook with a locale that does not require one of an update', async () => {
    const hook = (extra: string): string =>
      [
        "import { useLivePreviewDocument } from 'payload-live-preview/react';",
        'useLivePreviewDocument({',
        "  document: { collection: 'posts', id, locale: 'de' },",
        '  timeoutMs: 0,',
        extra,
        '});',
      ].join('\n');

    expect(places(await check({ 'src/a.tsx': hook('') }), 'hook-locale')).toEqual(['a.tsx:2']);
    expect(rules(await check({ 'src/a.tsx': hook('  requireLocale: true,') }))).toEqual([]);
    expect(
      places(await check({ 'src/a.tsx': hook('  requireLocale: false,') }), 'hook-locale'),
    ).toEqual(['a.tsx:2']);
  });
});

describe('pll doctor --v3: adapter options (rows 21, 27, 32, 33 and strict: false)', () => {
  it('lists an adapter that merges without a deadline, and not one that cannot merge', async () => {
    const handle = (options: string): string =>
      [
        "import { livePreviewHandle } from 'payload-live-preview/sveltekit';",
        `export const handle = livePreviewHandle(${options});`,
      ].join('\n');

    const merging = await check({
      'src/hooks.server.ts': handle(
        "{ allowedOrigins: [ADMIN], serverURL: 'https://cms.example.com' }",
      ),
    });
    expect(places(merging, 'merge-deadline')).toEqual(['hooks.server.ts:2']);

    // Without `serverURL` the runtime has no merger, so no merge waits for anything. Both name
    // their route strategy, which row 40 would list otherwise.
    expect(
      rules(
        await check({
          'src/hooks.server.ts': handle('{ allowedOrigins: [ADMIN], routeStrategy: false }'),
        }),
      ),
    ).toEqual([]);
    expect(
      rules(
        await check({
          'src/hooks.server.ts': handle(
            "{ serverURL: 'https://cms.example.com', mergeTimeoutMs: 0, routeStrategy: false }",
          ),
        }),
      ),
    ).toEqual([]);
  });

  it('lists a call from an entry that is no longer importable, and not one from the entries that stay (row 42)', async () => {
    const report = await check({
      'src/audit.ts': [
        "import { runDoctor } from 'payload-live-preview/doctor';",
        'await runDoctor({ url });',
      ].join('\n'),
      'src/upgrade.ts': [
        "import { migrateSource } from 'payload-live-preview/migrate';",
        'migrateSource(source);',
      ].join('\n'),
      'src/config.ts': [
        "import { buildLivePreviewUrl } from 'payload-live-preview/plugin';",
        "buildLivePreviewUrl({ baseUrl: 'https://site.example' });",
      ].join('\n'),
    });

    expect(places(report, 'tool-entries')).toEqual(['audit.ts:2', 'upgrade.ts:2']);
  });

  it('lists a page a framework hydrates that names neither a route strategy nor fragments (row 40)', async () => {
    const files = {
      'src/hooks.server.ts': [
        "import { livePreviewHandle } from 'payload-live-preview/sveltekit';",
        'export const handle = livePreviewHandle({ allowedOrigins: [ADMIN] });',
      ].join('\n'),
      'src/layout.tsx': [
        "import { LivePreviewScript } from 'payload-live-preview/nextjs';",
        'await LivePreviewScript({ request, allowedOrigins: [ADMIN] });',
        "await LivePreviewScript({ request, routeStrategy: 'after-save' });",
        "await LivePreviewScript({ request, fragments: { endpoint: '/payload/fragment' } });",
      ].join('\n'),
      'src/plugin.ts': [
        "import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';",
        'export default livePreviewNitroPlugin({ allowedOrigins: [ADMIN], routeStrategy: false });',
      ].join('\n'),
      // The bootstrap every visitor receives and Astro's integration keep no default strategy.
      'src/asset.tsx': [
        "import { livePreviewScriptProps } from 'payload-live-preview/nextjs';",
        "livePreviewScriptProps({ delivery: 'asset' });",
      ].join('\n'),
      'src/astro.config.ts': [
        "import { livePreview } from 'payload-live-preview/astro';",
        "livePreview({ mode: 'loader' });",
      ].join('\n'),
    };

    expect(places(await check(files), 'route-router')).toEqual([
      'hooks.server.ts:2',
      'layout.tsx:2',
    ]);
  });

  it('lists a hydrated page that asks for a route strategy or a fragment endpoint itself (row 47)', async () => {
    const report = await check({
      'src/layout.tsx': [
        "import { LivePreviewScript } from 'payload-live-preview/nextjs';",
        'await LivePreviewScript({ request, routeStrategy: true });',
        "await LivePreviewScript({ request, routeStrategy: 'after-save' });",
        "await LivePreviewScript({ request, fragments: { endpoint: '/payload/fragment' } });",
        "await LivePreviewScript({ request, routeStrategy: 'router' });",
        'await LivePreviewScript({ request, routeStrategy: false });',
        'await LivePreviewScript({ request, routeStrategy: chosen });',
      ].join('\n'),
      // Astro has no hydration owner: its route strategy keeps the fetch and morph.
      'src/middleware.ts': [
        "import { createLivePreviewMiddleware } from 'payload-live-preview/astro';",
        'export const onRequest = createLivePreviewMiddleware({ routeStrategy: true });',
      ].join('\n'),
    });

    expect(places(report, 'route-hydrated')).toEqual([
      'layout.tsx:2',
      'layout.tsx:3',
      'layout.tsx:4',
    ]);
    expect(formatV3Readiness(report)).toContain(
      "Row 47: On a Next.js, SvelteKit or Nuxt page, `routeStrategy: true`, `'after-save'` and the route of a fragment endpoint refresh through the router alone",
    );
  });

  it('lists the lean runtime where an integration or the generator is given it (row 37)', async () => {
    const report = await check({
      'src/preview.config.ts': [
        "import { livePreview } from 'payload-live-preview/astro';",
        "import { LEAN_RUNTIME } from 'payload-live-preview/lean';",
        'export const withLean = livePreview({ runtime: LEAN_RUNTIME });',
        "export const without = livePreview({ mode: 'loader' });",
      ].join('\n'),
    });

    expect(places(report, 'lean-runtime')).toEqual(['preview.config.ts:3']);
    expect(formatV3Readiness(report)).toContain(
      'Row 37: The lean runtime, `runtime: LEAN_RUNTIME` from `payload-live-preview/lean`, is removed',
    );
  });

  it("lists `strict: false` and `defaults: 'v1'` where an adapter is given them", async () => {
    const report = await check({
      'src/middleware.ts': [
        "import { createLivePreviewMiddleware } from 'payload-live-preview/astro';",
        'export const onRequest = createLivePreviewMiddleware({',
        '  strict: false,',
        "  defaults: 'v1',",
        '});',
      ].join('\n'),
    });

    expect(places(report, 'strict-false')).toEqual(['middleware.ts:2']);
    expect(places(report, 'defaults-v1')).toEqual(['middleware.ts:2']);
    // Each is a ledger row since 3.0 removed it, and the report names it by that row.
    const text = formatV3Readiness(report);
    expect(text).toContain(
      'Row 36: `strict: false`, which gated response changes on intent alone, is removed',
    );
    expect(text).toContain("Row 21: `defaults: 'v1'`, the 1.x profile, is removed");
  });

  it('lists the Astro integration without a mode, and only the Astro one', async () => {
    const report = await check({
      'src/astro.config.mjs': [
        "import { livePreview } from 'payload-live-preview/astro';",
        'export default { integrations: [livePreview()] };',
      ].join('\n'),
      'src/explicit.mjs': [
        "import { livePreview } from 'payload-live-preview/astro';",
        "export default { integrations: [livePreview({ mode: 'inline' })] };",
      ].join('\n'),
      // The Payload config plugin has the same name and no delivery mode.
      'src/payload.config.ts': [
        "import { livePreview } from 'payload-live-preview/plugin';",
        "export const plugins = [livePreview({ baseUrl: 'https://site.example.com' })];",
      ].join('\n'),
    });

    expect(places(report, 'astro-mode')).toEqual(['astro.config.mjs:2']);
  });

  it('lists the Next.js script helper unless it delivers the asset', async () => {
    const layout = (options: string): string =>
      [
        "import { livePreviewScriptProps } from 'payload-live-preview/nextjs';",
        `const props = livePreviewScriptProps(${options});`,
      ].join('\n');

    expect(places(await check({ 'src/layout.tsx': layout('{}') }), 'script-props-inline')).toEqual([
      'layout.tsx:2',
    ]);
    expect(rules(await check({ 'src/layout.tsx': layout("{ delivery: 'asset' }") }))).toEqual([]);
  });
});

describe('pll doctor --v3: sanitizing and the origin detector (rows 16, 18 and 22)', () => {
  it('lists a rich-text render without a document, and not one that names it or refuses', async () => {
    const report = await check({
      'src/render.ts': [
        "import { lexicalToHtml, setSanitizerDocument } from 'payload-live-preview/lexical';",
        'setSanitizerDocument(document);',
        'export const a = lexicalToHtml(content);',
        'export const b = lexicalToHtml(content, { blocks });',
        'export const c = lexicalToHtml(content, { document });',
        'export const d = lexicalToHtml(content, { requireDocument: true });',
        'export const e = lexicalToHtml(content, { sanitize: false });',
        // Since 3.0 an explicit `false` is the 2.x behaviour under its name: nothing changes there.
        'export const f = lexicalToHtml(content, { requireDocument: false });',
      ].join('\n'),
    });

    expect(places(report, 'lexical-document')).toEqual(['render.ts:3', 'render.ts:4']);
    expect(places(report, 'set-sanitizer-document')).toEqual(['render.ts:2']);
  });

  it('lists a detector built without saying whether it trusts the referrer', async () => {
    const report = await check({
      'src/detect.ts': [
        "import { OriginDetector } from 'payload-live-preview';",
        'export const a = new OriginDetector();',
        'export const b = new OriginDetector({ allowedOrigins });',
        'export const c = new OriginDetector({ enableReferrerDetection: false });',
      ].join('\n'),
    });

    expect(places(report, 'referrer-detection')).toEqual(['detect.ts:2', 'detect.ts:3']);
  });
});

describe('pll doctor --v3: options that are not written at the call', () => {
  it('reads a const in the same file, through a spread', async () => {
    const report = await check({
      'src/hooks.server.ts': [
        "import { livePreviewHandle } from 'payload-live-preview/sveltekit';",
        "const shared = { serverURL: 'https://cms.example.com' } as const;",
        'export const handle = livePreviewHandle({ ...shared, allowedOrigins: [ADMIN] });',
      ].join('\n'),
    });

    expect(places(report, 'merge-deadline')).toEqual(['hooks.server.ts:3']);
    expect(report.unread).toEqual([]);
  });

  it('reads a condition between two literals: what one side sets may be set', async () => {
    // The pattern of a site that names its CMS only where one is configured.
    const report = await check({
      'src/hooks.server.ts': [
        "import { livePreviewHandle } from 'payload-live-preview/sveltekit';",
        'const options = {',
        '  allowedOrigins: [ADMIN],',
        '  ...(CMS === undefined ? {} : { serverURL: CMS, mergeDepth: 1 }),',
        '};',
        'export const handle = livePreviewHandle(options);',
      ].join('\n'),
      'src/layout.tsx': [
        "import { LivePreviewScript } from 'payload-live-preview/nextjs';",
        'const admin = CMS === undefined ? {} : { serverURL: CMS };',
        'const guarded = { ...(DEADLINE && { mergeTimeoutMs: 5_000 }) };',
        'export const a = await LivePreviewScript({ ...admin, request });',
        'export const b = await LivePreviewScript({ ...admin, ...guarded, request });',
      ].join('\n'),
    });

    // Where it merges, nothing sets a deadline: both sides of the condition were read.
    expect(places(report, 'merge-deadline')).toEqual(['hooks.server.ts:6', 'layout.tsx:4']);
    // A deadline that is set only under a condition is neither there nor missing.
    expect(report.unread).toEqual([{ file: 'layout.tsx', line: 5, call: 'LivePreviewScript' }]);
  });

  it('follows a relative import to the const the other module declares', async () => {
    const report = await check({
      'src/app/live-preview.ts': [
        'export const livePreviewOptions = {',
        "  serverURL: 'https://cms.example.com',",
        "  delivery: 'asset',",
        '} as const;',
      ].join('\n'),
      'src/app/layout.tsx': [
        "import { livePreviewScriptProps } from 'payload-live-preview/nextjs';",
        "import { livePreviewOptions } from './live-preview';",
        'export const props = livePreviewScriptProps({ ...livePreviewOptions });',
      ].join('\n'),
    });

    expect(places(report, 'merge-deadline')).toEqual(['app/layout.tsx:3']);
    expect(places(report, 'script-props-inline')).toEqual([]);
    expect(report.unread).toEqual([]);
  });

  it('takes what both sides of a condition set as set, and a computed key as unknown', async () => {
    const report = await check({
      'src/build.ts': [
        "import { generateInlineScript } from 'payload-live-preview';",
        'const both = PROD',
        '  ? { serverURL: LIVE, mergeTimeoutMs: 5_000, debug: true }',
        '  : { serverURL: LOCAL, mergeTimeoutMs: 0 };',
        'export const a = generateInlineScript(both);',
        'export const b = generateInlineScript({ serverURL: LIVE, [KEY]: 1 });',
      ].join('\n'),
    });

    expect(report.rows).toEqual([]);
    expect(report.unread).toEqual([{ file: 'build.ts', line: 6, call: 'generateInlineScript' }]);
  });

  it('finds the module behind an emitted name and an index file, and not one that is missing', async () => {
    const report = await check({
      'src/lib/options.ts': [
        "export const SITE = 'https://site.example.com';",
        'export let later;',
        "export const shared = { serverURL: 'https://cms.example.com' };",
      ].join('\n'),
      'src/lib/index.ts':
        "export const viaIndex = { serverURL: 'https://cms.example.com', mergeTimeoutMs: 0 };\n",
      'src/hooks.ts': [
        "import { livePreviewHandle } from 'payload-live-preview/sveltekit';",
        // TypeScript's ESM spelling: the import names the file the compiler emits.
        "import { shared } from './lib/options.js';",
        "import { viaIndex } from './lib';",
        "import { gone } from './lib/gone';",
        'export const a = livePreviewHandle(shared);',
        'export const b = livePreviewHandle(viaIndex);',
        'export const c = livePreviewHandle(gone);',
      ].join('\n'),
    });

    expect(places(report, 'merge-deadline')).toEqual(['hooks.ts:5']);
    expect(report.unread).toEqual([{ file: 'hooks.ts', line: 7, call: 'livePreviewHandle' }]);
    expect(report.files).toBe(1);
  });

  it('says which calls it could not read, once each, instead of guessing', async () => {
    const report = await check({
      'src/layout.tsx': [
        "import { livePreviewScriptProps } from 'payload-live-preview/nextjs';",
        "import { livePreviewOptions } from '~/live-preview';",
        'export const props = livePreviewScriptProps(livePreviewOptions);',
      ].join('\n'),
    });

    expect(report.rows).toEqual([]);
    expect(report.unread).toEqual([
      { file: 'layout.tsx', line: 3, call: 'livePreviewScriptProps' },
    ]);
  });

  it('still lists what an open literal shows', async () => {
    const report = await check({
      'src/mw.ts': [
        "import { createLivePreviewMiddleware } from 'payload-live-preview/nextjs';",
        'export const mw = createLivePreviewMiddleware({ ...fromSomewhere(), strict: false });',
      ].join('\n'),
    });

    expect(places(report, 'strict-false')).toEqual(['mw.ts:2']);
    expect(report.unread).toEqual([
      { file: 'mw.ts', line: 2, call: 'createLivePreviewMiddleware' },
    ]);
  });
});

describe('pll doctor --v3: what it does not take for the package', () => {
  it('ignores a function of the same name that the file declares itself', async () => {
    const report = await check({
      'src/own.ts': 'function lexicalToHtml(value) { return value; }\nlexicalToHtml(content);\n',
      'src/none.ts': 'export const x = 1;\n',
    });

    expect(report.rows).toEqual([]);
    expect(report.files).toBe(0);
  });

  it('counts lines from the top of a component file', async () => {
    const report = await check({
      'src/pages/index.astro': [
        '---',
        "import { lexicalToHtml } from 'payload-live-preview/lexical';",
        'const html = lexicalToHtml(post.content);',
        '---',
        '<article set:html={html} />',
      ].join('\n'),
    });

    expect(places(report, 'lexical-document')).toEqual(['pages/index.astro:3']);
    expect(report.files).toBe(1);
  });
});

describe('pll doctor --v3: the report', () => {
  it('names each row once, with its places and what to do', async () => {
    const report = await check({
      'src/detect.ts':
        "import { OriginDetector } from 'payload-live-preview';\nnew OriginDetector();\n",
      'src/render.ts':
        "import { lexicalToHtml } from 'payload-live-preview';\nlexicalToHtml(content);\n",
    });

    expect(rules(report)).toEqual(['lexical-document', 'referrer-detection']);
    expect(formatV3Readiness(report)).toBe(
      [
        'pll doctor --v3 — what 3.0 changes in src (ADR 0007)',
        '',
        'Row 18: `lexicalToHtml()` without a document throws `SanitizerEnvironmentError`; 2.x returns unsanitised markup with a warning',
        '  render.ts:2',
        '  Pass `{ document }` to the call. `{ requireDocument: true }` takes the 3.0 behaviour now, `false` keeps the 2.x one.',
        '',
        'Row 22: `new OriginDetector()` no longer trusts `document.referrer` unless told to',
        '  detect.ts:2',
        '  Pass `enableReferrerDetection: true` where the detector relies on the referrer, `false` to take the 3.0 value now.',
        '',
        '2 place(s) in 2 row(s); 2 file(s) use the package.',
        '',
      ].join('\n'),
    );
  });

  it('says so when nothing it can read changes, and names what it could not read', async () => {
    const clean = await check({
      'src/render.ts':
        "import { lexicalToHtml } from 'payload-live-preview';\nlexicalToHtml(content, { document });\n",
    });
    expect(formatV3Readiness(clean)).toBe(
      [
        'pll doctor --v3 — what 3.0 changes in src (ADR 0007)',
        '',
        'No call in 1 file(s) that use the package changes with 3.0.',
        '',
      ].join('\n'),
    );

    const unread = await check({
      'src/a.ts':
        "import { livePreviewHandle } from 'payload-live-preview/sveltekit';\nlivePreviewHandle(options);\n",
    });
    expect(formatV3Readiness(unread)).toContain(
      [
        'Not read: 1 call(s) take options this check cannot follow (a value from another package, an alias path or a function call). The development notices name them at run time.',
        '  a.ts:2 livePreviewHandle',
      ].join('\n'),
    );
  });
});
