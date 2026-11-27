/**
 * Build the published package entries without cross-profile clean races.
 *
 * tsup executes array configs concurrently. A `clean: true` profile sharing an
 * output directory can therefore delete files another profile just emitted. The
 * production build instead removes the known `dist` directory once, then emits
 * the profiles in declaration order. Since 3.0 there is one: every entry as ESM,
 * with the modules two entries share as chunks (ADR 0012).
 */
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { build } from 'tsup';
import { BUILD_PROFILES } from '../tsup.config';
import { BOUNDARY_DIRECTORY } from './chunk-boundaries';
import { DIRECTIVE_ENTRIES } from './package-entries';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

/**
 * Callable names that stay observable on the built artefacts (`fn.name`), the
 * contract `scripts/check-bundle-size.ts` asserts: every function and class
 * `payload-live-preview/client` exports, and the root's that were on the list
 * before 3.0. Everything else is mangled.
 */
const PUBLIC_FUNCTION_NAMES: readonly string[] = [
  'bind',
  'bindByPath',
  'bindNavigationLifecycle',
  'buildFrameAncestors',
  'createAnalyticsPlugin',
  'createDocumentSession',
  'createPreviewBindings',
  'createPreviewFocusReporter',
  'createUnboundFieldsOverlayPlugin',
  'detectProtocolProfile',
  'documentSavePlugin',
  'escapeHtml',
  'EventEmitter',
  'generateCspNonce',
  'generateInlineScript',
  'initLivePreview',
  'isAuthorizedPreviewContext',
  'isExternalHttpUrl',
  'isLexicalContent',
  'isMorphBoundary',
  'isSafeUrl',
  'lexicalToHtml',
  'lexicalToPlainText',
  'LivePreviewClient',
  'markHydrated',
  'morphElement',
  'negotiateProtocol',
  'OriginDetector',
  'PluginManager',
  'registerBlockRenderer',
  'registerBuiltinRenderer',
  'registerRouteRefresh',
  'reportPreviewFocus',
  'retainIslandBoundary',
  'sanitizeHtml',
  'setSanitizerPolicy',
  'setTrustedTypesPolicy',
];
const PUBLIC_FUNCTION_NAME_PATTERN = new RegExp(`^(?:${PUBLIC_FUNCTION_NAMES.join('|')})$`, 'u');

await rm(DIST, { recursive: true, force: true });

for (const profile of BUILD_PROFILES) {
  await build({ ...profile, clean: false, config: false });
}

/**
 * `dist/<entry>.js` → the module directive its published file must start with.
 * esbuild drops a source directive and a banner alike when it bundles, so this
 * pass is the only place that can put one back.
 */
const DIRECTIVES = new Map<string, string>(
  Object.entries(DIRECTIVE_ENTRIES).map(([name, entry]) => [
    resolve(DIST, `${name}.js`),
    entry.directive,
  ]),
);

/**
 * esbuild lowers syntax and minifies whitespace; this pass mangles identifiers.
 * Names on the public allow-list are kept so `fn.name` stays meaningful, and
 * nothing else is preserved — a preserved internal name costs bytes in every
 * consumer bundle. Pure annotations survive so a consumer's bundler can drop
 * what it does not import. The original source map is supplied as input so
 * every published artefact still maps back to TypeScript, and a module
 * directive is written back through terser's `preamble`, which shifts that map
 * with it.
 */
async function compressJavaScript(path: string): Promise<void> {
  const sourceMapPath = `${path}.map`;
  const source = await readFile(path, 'utf8');
  const directive = DIRECTIVES.get(path);
  const result = await minify(source, {
    compress: { module: true, passes: 2 },
    ecma: 2022,
    // `preamble` rather than a prepended string: terser shifts the source map
    // for it, so the published file still maps back to TypeScript line by line.
    format: {
      comments: false,
      preserve_annotations: true,
      ...(directive !== undefined ? { preamble: directive } : {}),
    },
    // esbuild emits classes as `var X = class {}`, whose `.name` is inferred
    // from the binding; reserving the identifiers keeps the names for classes and
    // functions alike, where `keep_classnames` would only cover `class X {}`.
    keep_classnames: PUBLIC_FUNCTION_NAME_PATTERN,
    keep_fnames: PUBLIC_FUNCTION_NAME_PATTERN,
    mangle: { reserved: [...PUBLIC_FUNCTION_NAMES] },
    module: true,
    toplevel: true,
    sourceMap: {
      content: await readFile(sourceMapPath, 'utf8'),
      filename: basename(path),
      url: basename(sourceMapPath),
    },
  });
  if (result.code === undefined || result.map === undefined) {
    throw new Error(`Terser produced incomplete output for ${path}`);
  }
  const sourceMap = typeof result.map === 'string' ? result.map : JSON.stringify(result.map);
  await Promise.all([
    writeFile(path, result.code, 'utf8'),
    writeFile(sourceMapPath, sourceMap, 'utf8'),
  ]);
}

async function compressDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compressDirectory(path);
    } else if (entry.name.endsWith('.js')) {
      await compressJavaScript(path);
    }
  }
}

/**
 * esbuild emits a chunk for a module that held only types when several entries
 * import it, and a bare import of that chunk in each of them: an empty file a
 * consumer resolves and fetches for nothing. Before the minifier, where an
 * import stands on a line of its own, the import becomes an empty line, so the
 * source maps of the importing files stay as they are, and the chunk goes.
 */
async function dropEmptyChunks(): Promise<void> {
  const files = (await readdir(DIST, { recursive: true }))
    .filter((name) => name.endsWith('.js'))
    .map((name) => resolve(DIST, name));
  const empty = new Set<string>();
  for (const file of files) {
    if (!/^chunk-[A-Z0-9]+\.js$/u.test(basename(file))) continue;
    const code = await readFile(file, 'utf8');
    if (code.replace(/^\/\/# sourceMappingURL=.*$/gmu, '').trim() === '') empty.add(file);
  }
  if (empty.size === 0) return;
  for (const file of files) {
    if (empty.has(file)) continue;
    const code = await readFile(file, 'utf8');
    const kept = code.replace(
      /^import\s*["'](\.{1,2}\/[^"']+)["'];?[ \t]*$/gmu,
      (line, specifier: string) => (empty.has(resolve(dirname(file), specifier)) ? '' : line),
    );
    if (kept !== code) await writeFile(file, kept, 'utf8');
  }
  for (const file of empty) {
    await rm(file);
    await rm(`${file}.map`, { force: true });
  }
}

// The boundary entries drew their chunk boundaries; nothing imports their files.
await rm(resolve(DIST, BOUNDARY_DIRECTORY), { recursive: true, force: true });
await dropEmptyChunks();
await compressDirectory(DIST);
