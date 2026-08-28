/**
 * The SSR-only sanitizer surface must not reach the browser runtime, which
 * `scripts/build-runtime.ts` bundles with `__INLINE_BUILD__` defined.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

// esbuild refuses to load under the jsdom test environment, whose typed arrays
// come from another realm, so the bundle is produced in a plain Node process.
const BUNDLE_SCRIPT = `
import { build } from 'esbuild';
import { minify } from 'terser';
const result = await build({
  stdin: {
    contents: "import { sanitizeHtml } from './src/security/sanitizer';\\nglobalThis.s = sanitizeHtml;\\n",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, write: false, minify: true, format: 'iife', target: 'es2020',
  platform: 'browser', treeShaking: true, logLevel: 'silent',
  define: process.argv[1] === 'inline' ? { __INLINE_BUILD__: 'true' } : {},
  tsconfig: 'tsconfig.json',
});
// esbuild will not drop an unreferenced \`class extends Error\`; the runtime
// build's Terser pass does, so the check runs the same two stages.
const compressed = await minify(result.outputFiles[0].text, {
  compress: { passes: 3, module: true },
  ecma: 2020,
  mangle: true,
});
process.stdout.write(compressed.code);
`;

function bundleForBrowser(inlineBuild: boolean): string {
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', BUNDLE_SCRIPT, inlineBuild ? 'inline' : 'plain'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
}

describe('sanitizeHtml — the SSR surface under the browser build define', () => {
  it('keeps the SSR error and the injected document when the define is absent', () => {
    const bundled = bundleForBrowser(false);
    expect(bundled).toContain('provide one with setSanitizerDocument');
    expect(bundled).toContain('SanitizerEnvironmentError');
  });

  it('eliminates both under __INLINE_BUILD__', () => {
    // The guards read the define in place: routed through a helper, esbuild
    // will not inline the call, and the branch shipped to every page.
    const bundled = bundleForBrowser(true);
    expect(bundled).not.toContain('provide one with setSanitizerDocument');
    expect(bundled).not.toContain('SanitizerEnvironmentError');
  });
});
