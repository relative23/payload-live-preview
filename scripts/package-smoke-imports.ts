/**
 * Import the installed package the way consumers do: every declared export
 * specifier is loaded under both ESM and CommonJS, and a named function from
 * each surface is asserted so an entry that resolves but exports nothing still
 * fails. Codegen specifiers run in the consumer that provisioned the peer.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CODEGEN_EXPORT_NAMES,
  PEER_REQUIRED_EXPORT_NAMES,
  findExecutableBinFailures,
} from './package-smoke-manifest';
import { detailFor, exists, isRecord, run, type JsonRecord } from './package-smoke-support';

function packageSpecifier(name: string, exportName: string): string {
  return exportName === '.' ? name : `${name}/${exportName.slice(2)}`;
}

function conditionTarget(value: unknown, condition: 'import' | 'require'): string | undefined {
  if (!isRecord(value)) return undefined;
  const branch = value[condition];
  if (typeof branch === 'string') return branch;
  if (!isRecord(branch)) return undefined;
  return typeof branch['default'] === 'string' ? branch['default'] : undefined;
}

interface SpecifierPartition {
  readonly runtimeEsm: readonly string[];
  readonly codegenEsm: readonly string[];
  readonly peerEsm: readonly string[];
  readonly runtimeCjs: readonly string[];
  readonly codegenCjs: readonly string[];
}

function partitionExportSpecifiers(
  exportsValue: JsonRecord,
  packageName: string,
): SpecifierPartition {
  const runtimeEsm: string[] = [];
  const codegenEsm: string[] = [];
  const peerEsm: string[] = [];
  const runtimeCjs: string[] = [];
  const codegenCjs: string[] = [];
  for (const [exportName, conditions] of Object.entries(exportsValue)) {
    if (conditionTarget(conditions, 'import') !== undefined) {
      const target = CODEGEN_EXPORT_NAMES.has(exportName)
        ? codegenEsm
        : PEER_REQUIRED_EXPORT_NAMES.has(exportName)
          ? peerEsm
          : runtimeEsm;
      target.push(packageSpecifier(packageName, exportName));
    }
    if (conditionTarget(conditions, 'require') !== undefined) {
      const target = CODEGEN_EXPORT_NAMES.has(exportName) ? codegenCjs : runtimeCjs;
      target.push(packageSpecifier(packageName, exportName));
    }
  }
  return { runtimeEsm, codegenEsm, peerEsm, runtimeCjs, codegenCjs };
}

/** The Astro integration reads a virtual options module that only a bundler provides. */
async function writeVirtualModuleLoader(consumer: string): Promise<string> {
  const loader = resolve(consumer, 'virtual-module-loader.mjs');
  await writeFile(
    loader,
    [
      'const VIRTUAL_OPTIONS = "virtual:payload-live-preview/options";',
      'const VIRTUAL_URL = "data:text/javascript,export default {defaults:\\"v1\\"};";',
      'export function resolve(specifier, context, nextResolve) {',
      '  if (specifier === VIRTUAL_OPTIONS) return { url: VIRTUAL_URL, shortCircuit: true };',
      '  return nextResolve(specifier, context);',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  return loader;
}

function esmProbeSource(
  expected: Readonly<Record<string, readonly string[]>>,
  specifiers: readonly string[],
): string {
  return `const expected = ${JSON.stringify(expected)}; for (const specifier of ${JSON.stringify(specifiers)}) { const namespace = await import(specifier); if (typeof namespace !== 'object' || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`;
}

function cjsProbeSource(
  expected: Readonly<Record<string, readonly string[]>>,
  specifiers: readonly string[],
): string {
  return `const expected = ${JSON.stringify(expected)}; for (const specifier of ${JSON.stringify(specifiers)}) { const namespace = require(specifier); if ((typeof namespace !== 'object' && typeof namespace !== 'function') || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`;
}

function esmRuntimeExports(packageName: string): Readonly<Record<string, readonly string[]>> {
  return {
    [packageSpecifier(packageName, '.')]: ['LivePreviewClient', 'createPreviewFocusReporter'],
    [packageSpecifier(packageName, './core')]: ['EventEmitter', 'initLivePreview'],
    [packageSpecifier(packageName, './astro')]: ['livePreview', 'createLivePreviewMiddleware'],
    [packageSpecifier(packageName, './nextjs')]: ['createLivePreviewMiddleware'],
    [packageSpecifier(packageName, './sveltekit')]: ['livePreviewHandle'],
    [packageSpecifier(packageName, './nuxt')]: ['livePreviewNitroPlugin'],
    [packageSpecifier(packageName, './payload')]: ['buildLivePreviewUrl'],
    [packageSpecifier(packageName, './plugin')]: ['livePreview'],
    [packageSpecifier(packageName, './server')]: ['definePreview', 'authorizePreviewRequest'],
    [packageSpecifier(packageName, './client')]: [
      'LivePreviewClient',
      'createPreviewFocusReporter',
    ],
    [packageSpecifier(packageName, './structural')]: [
      'createStructuralArrayRenderer',
      'morphElement',
    ],
    [packageSpecifier(packageName, './lexical')]: ['lexicalToHtml', 'isLexicalContent'],
    [packageSpecifier(packageName, './plugins')]: ['PluginManager', 'createAnalyticsPlugin'],
    [packageSpecifier(packageName, './fragment')]: [
      'createFragmentStrategy',
      'parseFragmentResponse',
    ],
    [packageSpecifier(packageName, './astro/middleware-entry')]: ['onRequest'],
  };
}

function cjsRuntimeExports(packageName: string): Readonly<Record<string, readonly string[]>> {
  return {
    [packageSpecifier(packageName, '.')]: ['LivePreviewClient', 'createPreviewFocusReporter'],
    [packageSpecifier(packageName, './core')]: ['EventEmitter', 'initLivePreview'],
    [packageSpecifier(packageName, './payload')]: ['buildLivePreviewUrl'],
    [packageSpecifier(packageName, './plugin')]: ['livePreview'],
    [packageSpecifier(packageName, './server')]: ['definePreview', 'authorizePreviewRequest'],
    [packageSpecifier(packageName, './client')]: [
      'LivePreviewClient',
      'createPreviewFocusReporter',
    ],
    [packageSpecifier(packageName, './structural')]: [
      'createStructuralArrayRenderer',
      'morphElement',
    ],
    [packageSpecifier(packageName, './lexical')]: ['lexicalToHtml', 'isLexicalContent'],
    [packageSpecifier(packageName, './plugins')]: ['PluginManager', 'createAnalyticsPlugin'],
    [packageSpecifier(packageName, './fragment')]: [
      'createFragmentStrategy',
      'parseFragmentResponse',
    ],
  };
}

/**
 * Every entry is its own bundle with its own copy of the sanitizer, so a
 * document supplied through one entry must reach the rich text another renders.
 * 2.0.1 kept it per copy: `lexicalToHtml` from `/lexical` warned and returned
 * unsanitised HTML on a server that had called the root's setter. The fake
 * document counts the one `createElement('template')` a sanitising pass makes.
 *
 * The probe is a fixed text; the two specifiers arrive as arguments
 * (`process.argv[1]` and `[2]`), so no value is spliced into code.
 */
const SHARED_SANITIZER_DOCUMENT_BODY = [
  'let calls = 0; const warnings = [];',
  'console.warn = (message) => { warnings.push(String(message)); };',
  "root.setSanitizerDocument({ createElement: () => { calls += 1; return { innerHTML: '', content: { childNodes: [] } }; } });",
  "lexical.lexicalToHtml({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x', format: 0 }] }] } });",
  "if (calls !== 1 || warnings.length > 0) throw new Error('lexicalToHtml from /lexical did not use the document set through the root: ' + calls + ' template(s), ' + JSON.stringify(warnings));",
  'lexical.setSanitizerDocument(null);',
  "root.lexicalToHtml({ root: { type: 'root', children: [] } });",
  "if (calls !== 1 || warnings.length !== 1) throw new Error('clearing through /lexical did not clear the root: ' + calls + ' template(s), ' + warnings.length + ' warning(s)');",
].join(' ');

const SHARED_SANITIZER_DOCUMENT_PROBES: Readonly<Record<'esm' | 'cjs', string>> = {
  esm: `const root = await import(process.argv[1]); const lexical = await import(process.argv[2]); ${SHARED_SANITIZER_DOCUMENT_BODY}`,
  cjs: `const root = require(process.argv[1]); const lexical = require(process.argv[2]); (async () => { ${SHARED_SANITIZER_DOCUMENT_BODY} })().catch((error) => { console.error(error); process.exit(1); });`,
};

/**
 * Characterise the public `/lexical` entry in Node, where no DOM is global.
 * Built-ins escape their inputs, while custom renderers are trusted code and
 * stay unsanitised when the caller supplies no parser; that path must warn.
 * Explicit per-call documents isolate concurrent requests, and the legacy
 * root-entry setter remains a cross-bundle fallback until 3.0 (ADR 0002).
 *
 * The executable markup below is a fixed probe string. Package specifiers are
 * process arguments, never interpolated into this source.
 */
const DOMLESS_LEXICAL_BODY = [
  "if (typeof globalThis.document !== 'undefined') throw new Error('Node unexpectedly has a global document');",
  'lexical.registerDefaultBlocks();',
  'lexical.registerLexicalNode(\'package-smoke-active-node\', () => \'<script data-plp-smoke="node">globalThis.__plpPackageSmoke = true</script><a href="javascript:alert(1)">node</a>\');',
  'lexical.registerBlockRenderer(\'package-smoke-active-block\', () => \'<img src="/pixel.png" onerror="globalThis.__plpPackageSmoke = true"><a href="javascript:alert(1)">block</a>\');',
  "const content = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'built <img src=x onerror=alert(1)>', format: 0 }] }, { type: 'block', fields: { blockType: 'callout', text: 'default <svg onload=alert(1)>' } }, { type: 'package-smoke-active-node' }, { type: 'block', fields: { blockType: 'package-smoke-active-block' } }] } };",
  'const warnings = []; const originalWarn = console.warn;',
  'console.warn = (message) => { warnings.push(String(message)); };',
  'let withoutDocument;',
  'try { withoutDocument = lexical.lexicalToHtml(content); } finally { console.warn = originalWarn; }',
  "if (!withoutDocument.includes('&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;')) throw new Error('built-in text did not escape markup without a DOM');",
  "if (!withoutDocument.includes('&lt;svg onload&#x3D;alert(1)&gt;')) throw new Error('built-in block did not escape fields without a DOM');",
  "if (!withoutDocument.includes('<script data-plp-smoke=\"node\">') || !withoutDocument.includes(' onerror=\"globalThis.__plpPackageSmoke = true\"')) throw new Error('DOM-less trusted custom markup contract changed');",
  "if (warnings.length !== 1 || !warnings[0].includes('returned unsanitised HTML')) throw new Error('DOM-less render did not emit its warning exactly once: ' + JSON.stringify(warnings));",
  "const documentFacade = () => { const dom = new JSDOM('<!doctype html><html><body></body></html>'); let calls = 0; return { value: { createElement: (tag) => { calls += 1; return dom.window.document.createElement(tag); } }, calls: () => calls, close: () => { dom.window.close(); } }; };",
  'const first = documentFacade(); const second = documentFacade(); const fallback = documentFacade();',
  "const assertSanitised = (html, label) => { if (html.includes('<script') || html.includes(' onerror=\"') || html.includes('href=\"javascript:')) throw new Error(label + ' kept active custom markup: ' + html); };",
  'try {',
  '  root.setSanitizerDocument(fallback.value);',
  '  const [firstHtml, secondHtml] = await Promise.all([Promise.resolve().then(() => lexical.lexicalToHtml(content, { document: first.value })), Promise.resolve().then(() => lexical.lexicalToHtml(content, { document: second.value }))]);',
  "  assertSanitised(firstHtml, 'first per-call document'); assertSanitised(secondHtml, 'second per-call document');",
  "  if (first.calls() !== 1 || second.calls() !== 1 || fallback.calls() !== 0) throw new Error('per-call documents were not isolated: ' + [first.calls(), second.calls(), fallback.calls()].join('/'));",
  '  const fallbackHtml = lexical.lexicalToHtml(content);',
  "  assertSanitised(fallbackHtml, 'global fallback document');",
  "  if (fallback.calls() !== 1) throw new Error('global fallback document was called ' + String(fallback.calls()) + ' times');",
  '} finally {',
  '  lexical.setSanitizerDocument(null); first.close(); second.close(); fallback.close();',
  '}',
  "if (typeof globalThis.document !== 'undefined') throw new Error('the Lexical smoke installed a global document');",
  "if (globalThis.__plpPackageSmoke !== undefined) throw new Error('the fixed custom markup executed inside the smoke');",
].join('\n');

const DOMLESS_LEXICAL_PROBES: Readonly<Record<'esm' | 'cjs', string>> = {
  esm: `const { JSDOM } = await import('jsdom'); const root = await import(process.argv[1]); const lexical = await import(process.argv[2]); ${DOMLESS_LEXICAL_BODY}`,
  cjs: `const { JSDOM } = require('jsdom'); const root = require(process.argv[1]); const lexical = require(process.argv[2]); (async () => { ${DOMLESS_LEXICAL_BODY} })().catch((error) => { console.error(error); process.exit(1); });`,
};

/** Fixed public-entry contract; package names are argv, never generated code. */
const PAYLOAD_SCOPE_PROBE = `
const { strict: assert } = await import('node:assert');
const root = await import(process.argv[1]);
const server = await import(process.argv[2]);
const site = 'https://preview.example.test';
const cms = 'https://cms.example.test';
const verdict = await root.authorizePreviewRequest(new Request(site + '/page'), {
  type: 'verifier', verify: () => ({ expiresAt: Date.now() + 60000,
    scope: { audience: site, path: '/page', locale: 'de', payload: {
      serverURL: cms, document: { kind: 'collection', slug: 'posts', id: 'a' }, maxDepth: 1,
    } }, payloadHeaders: { cookie: 'payload-token=package-scope-user' },
  }),
});
assert.equal(verdict.authorized, true);
let reads = 0;
const preview = server.definePreview({ serverURL: cms, depth: 1, fetch: async (url, init) => {
  reads += 1;
  assert.equal(new URL(url).pathname, '/api/posts/a');
  assert.equal(new Headers(init.headers).get('cookie'), 'payload-token=package-scope-user');
  return { ok: true, status: 200, json: async () => ({ id: 'a', title: 'draft' }) };
} });
const read = { collection: 'posts', id: 'a', locale: 'de', authorization: verdict.context };
assert.equal((await preview.fetchDocument(read)).data.title, 'draft');
assert.equal((await preview.fetchDocument({ ...read, id: 'b' })).reason, 'scope');
assert.equal(reads, 1);
for (const adapter of ['astro', 'nextjs', 'sveltekit', 'nuxt']) {
  const { createFragmentEndpoint } = await import(process.argv[1] + '/' + adapter);
  let propsCalls = 0;
  const endpoint = createFragmentEndpoint({ authorizePreview: () => verdict.context,
    registry: { hero: { component: () => null, props: (input) => {
      propsCalls += 1; return { title: input.fields.title };
    } } }, render: async (_component, props) => '<h1>' + props.title + '</h1>',
  });
  for (const id of ['a', 'b']) {
    const request = new Request(site + '/payload/fragment', { method: 'POST',
      headers: { origin: site, 'content-type': 'application/json' },
      body: JSON.stringify({ fragment: 'hero', route: '/page', search: '', revision: 1,
        locale: 'de', collectionSlug: 'posts', fields: { id, title: 'UNSAVED' } }),
    });
    const response = adapter === 'astro' || adapter === 'sveltekit'
      ? await endpoint({ request }) : await endpoint(request);
    assert.equal(response.status, id === 'a' ? 200 : 403, adapter);
    const body = await response.json();
    if (id === 'a') assert.equal(body.html, '<h1>UNSAVED</h1>');
    else assert.deepEqual(body, { error: 'unauthorized' });
  }
  assert.equal(propsCalls, 1, adapter);
}
`;

function codegenBinary(codegenConsumer: string): string {
  return process.platform === 'win32'
    ? resolve(codegenConsumer, 'node_modules/.bin/pll-codegen.cmd')
    : resolve(codegenConsumer, 'node_modules/.bin/pll-codegen');
}

/**
 * The two answers a consumer gets before installing the optional peer: the
 * help text and a usage error. `ts-morph` is needed to read a Payload config,
 * not to parse a flag, so an entry that resolves it at load time answers both
 * with `ERR_MODULE_NOT_FOUND` and a stack trace. Measured against the
 * published 2.0.0-rc.1, which did exactly that.
 */
function checkPeerFreeCli(consumer: string): readonly string[] {
  const failures: string[] = [];
  for (const argv of [['--help'], ['annotate', '--help']]) {
    const help = run(codegenBinary(consumer), argv, consumer);
    if (help.status !== 0 || !help.stdout.includes('Usage:')) {
      failures.push(`peer-free CLI \`${argv.join(' ')}\` failed:\n${detailFor(help)}`);
    }
  }
  const generation = run(
    codegenBinary(consumer),
    ['--config', 'payload.config.ts', '--out', 'types.ts'],
    consumer,
  );
  if (generation.status !== 1 || !generation.stderr.includes('needs ts-morph')) {
    failures.push(`peer-free CLI did not name the missing peer:\n${detailFor(generation)}`);
  }
  return failures;
}

async function checkPackedCli(
  codegenConsumer: string,
  codegenPackageRoot: string,
  manifestValue: JsonRecord,
): Promise<readonly string[]> {
  const binValue = manifestValue['bin'];
  if (!isRecord(binValue) || typeof binValue['pll-codegen'] !== 'string') {
    return ['manifest does not declare the pll-codegen binary'];
  }

  const failures: string[] = [];
  const cli = run(codegenBinary(codegenConsumer), ['--help'], codegenConsumer);
  if (cli.status !== 0 || !cli.stdout.includes('Usage:')) {
    failures.push(`packed CLI --help smoke failed:\n${detailFor(cli)}`);
  }

  const cliConfig = resolve(codegenConsumer, 'payload.config.ts');
  const cliOutput = resolve(codegenConsumer, 'generated-payload-types.ts');
  await writeFile(
    cliConfig,
    `export default { globals: [{ slug: 'homepage', fields: [{ name: 'title', type: 'text' }] }], collections: [] };\n`,
    'utf8',
  );
  const generation = run(
    codegenBinary(codegenConsumer),
    ['--config', cliConfig, '--out', cliOutput, '--quiet'],
    codegenConsumer,
  );
  if (generation.status !== 0 || !(await exists(cliOutput))) {
    failures.push(`packed CLI generation smoke failed:\n${detailFor(generation)}`);
  } else {
    const generated = await readFile(cliOutput, 'utf8');
    if (!generated.includes('export interface Homepage') || !generated.includes('title?: string')) {
      failures.push('packed CLI generated an unexpected type surface');
    }
  }

  failures.push(...(await findExecutableBinFailures(codegenPackageRoot, binValue['pll-codegen'])));
  return failures;
}

export async function checkPackedImportSmokes(inputs: {
  readonly consumer: string;
  readonly codegenConsumer: string;
  /** Isolated Node consumer with the reviewed SSR DOM installed explicitly. */
  readonly lexicalConsumer: string;
  /** Installs the peers the entries in `PEER_REQUIRED_EXPORT_NAMES` import. */
  readonly peerConsumer: string;
  readonly codegenPackageRoot: string;
  readonly packageName: string;
  readonly manifestValue: JsonRecord;
}): Promise<readonly string[]> {
  const exportsValue = inputs.manifestValue['exports'];
  if (!isRecord(exportsValue)) throw new Error('packed package.json has no exports map');
  const specifiers = partitionExportSpecifiers(exportsValue, inputs.packageName);
  const loader = await writeVirtualModuleLoader(inputs.consumer);

  const esmCodegenExports: Readonly<Record<string, readonly string[]>> = {
    [packageSpecifier(inputs.packageName, './codegen')]: ['generateTypes'],
    [packageSpecifier(inputs.packageName, './migrate')]: ['migrateSource', 'CODEMODS'],
    [packageSpecifier(inputs.packageName, './codegen/astro')]: ['livePreviewCodegen'],
  };
  const cjsCodegenExports: Readonly<Record<string, readonly string[]>> = {
    [packageSpecifier(inputs.packageName, './codegen')]: ['generateTypes'],
  };

  const failures: string[] = [...checkPeerFreeCli(inputs.consumer)];
  const esm = run(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-loader',
      loader,
      '--input-type=module',
      '--eval',
      esmProbeSource(esmRuntimeExports(inputs.packageName), specifiers.runtimeEsm),
    ],
    inputs.consumer,
  );
  if (esm.status !== 0) {
    failures.push(`peer-free ESM import smoke failed:\n${detailFor(esm)}`);
  }

  const scoped = run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      PAYLOAD_SCOPE_PROBE,
      packageSpecifier(inputs.packageName, '.'),
      packageSpecifier(inputs.packageName, './server'),
    ],
    inputs.consumer,
  );
  if (scoped.status !== 0) {
    failures.push(`packed document-scope contract failed:\n${detailFor(scoped)}`);
  }

  const codegenEsm = run(
    process.execPath,
    ['--input-type=module', '--eval', esmProbeSource(esmCodegenExports, specifiers.codegenEsm)],
    inputs.codegenConsumer,
  );
  if (codegenEsm.status !== 0) {
    failures.push(`peer-provisioned ESM codegen smoke failed:\n${detailFor(codegenEsm)}`);
  }

  const peerEsm = run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      esmProbeSource(
        {
          [packageSpecifier(inputs.packageName, './react')]: ['useLivePreviewDocument'],
          [packageSpecifier(inputs.packageName, './vue')]: ['useLivePreviewDocument'],
        },
        specifiers.peerEsm,
      ),
    ],
    inputs.peerConsumer,
  );
  if (peerEsm.status !== 0) {
    failures.push(`peer-provisioned ESM hook smoke failed:\n${detailFor(peerEsm)}`);
  }

  const cjs = run(
    process.execPath,
    [
      '--input-type=commonjs',
      '--eval',
      cjsProbeSource(cjsRuntimeExports(inputs.packageName), specifiers.runtimeCjs),
    ],
    inputs.consumer,
  );
  if (cjs.status !== 0) {
    failures.push(`peer-free CommonJS import smoke failed:\n${detailFor(cjs)}`);
  }

  for (const format of ['esm', 'cjs'] as const) {
    const shared = run(
      process.execPath,
      [
        `--input-type=${format === 'esm' ? 'module' : 'commonjs'}`,
        '--eval',
        SHARED_SANITIZER_DOCUMENT_PROBES[format],
        packageSpecifier(inputs.packageName, '.'),
        packageSpecifier(inputs.packageName, './lexical'),
      ],
      inputs.consumer,
    );
    if (shared.status !== 0) {
      failures.push(
        `${format} sanitizer document is not shared across entries:\n${detailFor(shared)}`,
      );
    }
  }

  for (const format of ['esm', 'cjs'] as const) {
    const lexical = run(
      process.execPath,
      [
        `--input-type=${format === 'esm' ? 'module' : 'commonjs'}`,
        '--eval',
        DOMLESS_LEXICAL_PROBES[format],
        packageSpecifier(inputs.packageName, '.'),
        packageSpecifier(inputs.packageName, './lexical'),
      ],
      inputs.lexicalConsumer,
    );
    if (lexical.status !== 0) {
      failures.push(
        `${format} DOM-less Lexical sanitizer-context smoke failed:\n${detailFor(lexical)}`,
      );
    }
  }

  const codegenCjs = run(
    process.execPath,
    ['--input-type=commonjs', '--eval', cjsProbeSource(cjsCodegenExports, specifiers.codegenCjs)],
    inputs.codegenConsumer,
  );
  if (codegenCjs.status !== 0) {
    failures.push(`peer-provisioned CommonJS codegen smoke failed:\n${detailFor(codegenCjs)}`);
  }

  failures.push(
    ...(await checkPackedCli(
      inputs.codegenConsumer,
      inputs.codegenPackageRoot,
      inputs.manifestValue,
    )),
  );
  return failures;
}
