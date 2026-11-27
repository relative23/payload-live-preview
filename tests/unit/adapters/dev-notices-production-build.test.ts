/**
 * The 3.0 notice a hook still has (ADR 0026) reads `process.env.NODE_ENV` in
 * place, so a production build drops it together with its text: a visitor of a
 * Vite or Next.js production build downloads none of it. The React hook and the
 * Vue composable are bundled here the way such a build does, with the define and
 * a minifier, once per mode. The client runtime has no notice left since the
 * origin detector's default changed (ADR 0007, row 22).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

// esbuild refuses to load under the jsdom test environment, whose typed arrays
// come from another realm, so the bundle is produced in a plain Node process.
// Vite's production build minifies with esbuild as well.
const BUNDLE_SCRIPT = `
import { build } from 'esbuild';
const [entry, symbol, mode] = process.argv.slice(1);
const result = await build({
  stdin: {
    contents: 'import { ' + symbol + " } from './" + entry + "';\\nglobalThis.s = " + symbol + ';\\n',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, write: false, minify: true, format: 'esm', target: 'es2022',
  platform: 'browser', treeShaking: true, logLevel: 'silent',
  external: ['react', 'vue'],
  define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
  tsconfig: 'tsconfig.json',
});
process.stdout.write(result.outputFiles[0].text);
`;

function bundle(entry: string, symbol: string, mode: 'production' | 'development'): string {
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', BUNDLE_SCRIPT, entry, symbol, mode],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
}

// One phrase of the notice, and the registry every notice goes through.
const HOOK = ['3.0 sets a default'];
const REGISTRY = '__payloadLivePreviewNotices';

const BUNDLES = [
  {
    name: 'the React hook',
    entry: 'src/adapters/react/index',
    symbol: 'useLivePreviewDocument',
    texts: HOOK,
  },
  {
    name: 'the Vue composable',
    entry: 'src/adapters/vue/index',
    symbol: 'useLivePreviewDocument',
    texts: HOOK,
  },
] as const;

describe.each(BUNDLES)('$name', ({ entry, symbol, texts }) => {
  it('carries no notice and no registry in a production build', () => {
    const code = bundle(entry, symbol, 'production');
    // The session and the origin detector are in it, only the notice is not.
    expect(code.length).toBeGreaterThan(10_000);
    for (const text of [...texts, REGISTRY]) expect(code).not.toContain(text);
  });

  it('keeps every notice in a development build', () => {
    const code = bundle(entry, symbol, 'development');
    for (const text of [...texts, REGISTRY]) expect(code).toContain(text);
  });
});
