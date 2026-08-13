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

/** Public callable names exposed by `payload-live-preview/core`. */
const CORE_PUBLIC_FUNCTION_NAMES =
  /^(?:EventEmitter|LivePreviewClient|OriginDetector|bind|bindByPath|buildFrameAncestors|buildScriptSrcWithNonce|detectInitialLocale|escapeHtml|escapeHtmlAttribute|generateCspNonce|hasCapability|initLivePreview|isDevMode|isExternalHttpUrl|isInIframe|isInPopup|isInPreviewContext|isSafeUrl|negotiateProtocol|sanitizeHtml|setCspCrypto|setSanitizerDocument)$/;

await rm(DIST, { recursive: true, force: true });

for (const profile of BUILD_PROFILES) {
  await build({ ...profile, clean: false, config: false });
}

/**
 * esbuild performs syntax lowering and tree shaking. Most profiles preserve
 * names up front; the dedicated core profile leaves internal names minifiable
 * and the final pass preserves its complete public callable allow-list instead.
 * The original source map is supplied as input so every published artifact still
 * maps back to TypeScript.
 */
async function compressJavaScript(path: string): Promise<void> {
  const sourceMapPath = `${path}.map`;
  const isModule = path.endsWith('.js');
  const isCoreEntry = /^core\.(?:cjs|js)$/.test(basename(path));
  const result = await minify(await readFile(path, 'utf8'), {
    compress: { module: isModule, passes: isCoreEntry ? 3 : 2 },
    ecma: 2022,
    format: { comments: false },
    keep_classnames: isCoreEntry ? CORE_PUBLIC_FUNCTION_NAMES : false,
    keep_fnames: isCoreEntry ? CORE_PUBLIC_FUNCTION_NAMES : false,
    mangle: true,
    module: isModule,
    toplevel: isCoreEntry,
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
