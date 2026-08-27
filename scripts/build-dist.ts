/**
 * Build the published package entries without cross-profile clean races.
 *
 * tsup executes array configs concurrently. A `clean: true` profile sharing an
 * output directory can therefore delete files another profile just emitted. The
 * production build instead removes the known `dist` directory once, then emits
 * the dual-format, dedicated core, and ESM-only profiles in declaration order.
 */
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { build } from 'tsup';
import { BUILD_PROFILES } from '../tsup.config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

/**
 * Callable names that stay observable on the built artefacts (`fn.name`), the
 * contract `scripts/check-bundle-size.ts` asserts. Everything else is mangled.
 */
const PUBLIC_FUNCTION_NAMES: readonly string[] = [
  'EventEmitter',
  'LivePreviewClient',
  'OriginDetector',
  'generateInlineScript',
  'bind',
  'bindByPath',
  'buildFrameAncestors',
  'buildScriptSrcWithNonce',
  'createPreviewBindings',
  'detectProtocolProfile',
  'isAuthorizedPreviewContext',
  'isInsideIsland',
  'detectInitialLocale',
  'escapeHtml',
  'escapeHtmlAttribute',
  'generateCspNonce',
  'hasCapability',
  'initLivePreview',
  'isDevMode',
  'isExternalHttpUrl',
  'isInIframe',
  'isInPopup',
  'isInPreviewContext',
  'isSafeUrl',
  'negotiateProtocol',
  'sanitizeHtml',
  'setCspCrypto',
  'setSanitizerDocument',
];
const PUBLIC_FUNCTION_NAME_PATTERN = new RegExp(`^(?:${PUBLIC_FUNCTION_NAMES.join('|')})$`, 'u');

await rm(DIST, { recursive: true, force: true });

for (const profile of BUILD_PROFILES) {
  await build({ ...profile, clean: false, config: false });
}

/**
 * esbuild lowers syntax and minifies whitespace; this pass mangles identifiers.
 * Names on the public allow-list are kept so `fn.name` stays meaningful, and
 * nothing else is preserved — a preserved internal name costs bytes in every
 * consumer bundle. Pure annotations survive so a consumer's bundler can drop
 * what it does not import. The original source map is supplied as input so
 * every published artefact still maps back to TypeScript.
 */
async function compressJavaScript(path: string): Promise<void> {
  const sourceMapPath = `${path}.map`;
  const isModule = path.endsWith('.js');
  const result = await minify(await readFile(path, 'utf8'), {
    compress: { module: isModule, passes: 2 },
    ecma: 2022,
    format: { comments: false, preserve_annotations: true },
    // esbuild emits classes as `var X = class {}`, whose `.name` is inferred
    // from the binding; reserving the identifiers keeps the names for classes and
    // functions alike, where `keep_classnames` would only cover `class X {}`.
    keep_classnames: PUBLIC_FUNCTION_NAME_PATTERN,
    keep_fnames: PUBLIC_FUNCTION_NAME_PATTERN,
    mangle: { reserved: [...PUBLIC_FUNCTION_NAMES] },
    module: isModule,
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
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) {
      await compressJavaScript(path);
    }
  }
}

await compressDirectory(DIST);
