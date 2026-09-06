/**
 * Tree shaking, measured. A consumer that imports one symbol must ship that
 * symbol's code, not the barrel it came from: each fixture is a one-line
 * consumer bundled with Vite through a real `node_modules` resolution, so the
 * manifest's `exports` and `sideEffects` decide what survives.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { improvementNotice } from './size-budget-notice';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Fixture {
  /** The specifier the consumer imports from. */
  readonly from: string;
  /** The one symbol it imports. */
  readonly symbol: string;
  /** How the consumer uses it, so nothing is dropped as unused. */
  readonly use: string;
  /** Gzip budget in bytes. */
  readonly gzip: number;
  /** What the number stands for. */
  readonly why: string;
}

/**
 * Measured 2026-08-27; headroom ~1.5 %.
 *
 * The three client rows and the generator row rose twice on 2026-09-06: for the
 * lean profile's own code (the LP0104 message, the renderers that report it, the two
 * strategy warnings as shared functions). The lean artifact itself is not in any
 * of them: it lives behind `payload-live-preview/lean`, measured below. Then
 * again for LP0503, the line a page prints when a trusted admin sends a message
 * this runtime does not recognise.
 *
 * The three rows carrying the inline runtime were raised on 2026-09-06 for the
 * ~660 B gzip `onUnboundChange` costs it (see bundle-budgets.ts). The generator
 * row moved furthest because it also gained the route prelude alongside the
 * fragment one — a second copy of the runtime's own strategy source, which the
 * generator embeds whole and cannot shake. Raised again the same day for
 * `data-payload-format`.
 *
 * 2026-09-06: the numbers are Vite 7's, because that is the newest major the
 * repository's own dev tooling accepts (`@codspeed/vitest-plugin` peers below
 * 8) — the record and the reason live in `quality/compat-matrix.json`.
 *
 * Vite 8 was measured before that constraint surfaced, and the measurement is
 * worth keeping: it bundles with Rolldown instead of Rollup, which is less
 * precise at dropping unused declarations out of a bundled module —
 * `escapeHtml` from the barrel came out at 2 378 B against Rollup's 220, and
 * `payload-live-preview/plugins` about a fifth larger. Consumers on Astro 7 or
 * Nuxt get that bundler, so the difference is theirs, not ours; the focused
 * entries were within a few percent either way.
 *
 * One thing did not survive the move unassisted, and its fix is still in
 * place. The runtime source is emitted as chunks joined at load
 * (scripts/serialize-source.ts), and Rolldown would not prove that call pure:
 * importing `escapeHtml` from the barrel came out at 32 512 B gzip — the whole
 * package — until the expression was annotated `\/* @__PURE__ *\/`. Rollup drops
 * it either way, so the annotation costs nothing here and is what keeps the
 * barrel shakeable for a consumer on 8.
 *
 * 2026-09-06 (LP0409): the two Lexical rows rise ~350 B gzip. The renderer
 * writes sanitized HTML, so it pulls the sanitizer, and the sanitizer now
 * carries the message it prints when the strict policy drops an attribute the
 * 1.x default kept.
 */
export const TREE_SHAKING_FIXTURES: readonly Fixture[] = [
  {
    from: 'payload-live-preview',
    symbol: 'escapeHtml',
    use: 'export const out = escapeHtml(String(Date.now()));',
    gzip: 224,
    why: 'a pure helper from the root barrel: the barrel itself costs nothing',
  },
  {
    from: 'payload-live-preview',
    symbol: 'lexicalToHtml',
    use: 'export const out = lexicalToHtml({ root: { children: [] } });',
    gzip: 5_118,
    why: 'the Lexical renderer from the root barrel, on par with payload-live-preview/lexical',
  },
  {
    from: 'payload-live-preview',
    symbol: 'initLivePreview',
    use: 'export const out = initLivePreview({});',
    gzip: 39_236,
    why: 'the client with its built-in renderers from the root barrel, on par with payload-live-preview/client',
  },
  {
    from: 'payload-live-preview',
    symbol: 'generateInlineScript',
    use: 'export const out = generateInlineScript({});',
    gzip: 37_151,
    why: 'the generator carries the inline runtime source and nothing of the client (the lean one lives behind payload-live-preview/lean)',
  },
  {
    from: 'payload-live-preview/core',
    symbol: 'initLivePreview',
    use: 'export const out = initLivePreview({});',
    gzip: 39_211,
    why: 'the client from the core entry: the same code, the same size',
  },
  {
    from: 'payload-live-preview/lexical',
    symbol: 'lexicalToHtml',
    use: 'export const out = lexicalToHtml({ root: { children: [] } });',
    gzip: 5_251,
    why: 'the Lexical renderer from its focused entry',
  },
  {
    from: 'payload-live-preview/structural',
    symbol: 'morphElement',
    use: 'export const out = morphElement(document.body, document.body, { keyAttributes: [] });',
    gzip: 1_493,
    why: 'the keyed morph alone, without the array renderer',
  },
  {
    from: 'payload-live-preview/nextjs',
    symbol: 'createLivePreviewMiddleware',
    use: 'export const out = createLivePreviewMiddleware({});',
    gzip: 42_011,
    why: 'the Next.js middleware without the fragment endpoint: ~2.4 KB gzip less than the whole entry, so a project that registers no fragment ships none of it. It does carry the bootstrap source, because delivery is decided where the script body is built',
  },
  {
    from: 'payload-live-preview/lean',
    symbol: 'LEAN_RUNTIME',
    use: 'export const out = LEAN_RUNTIME.source.length;',
    gzip: 25_890,
    why: 'the lean artifact as a value: the embedded script and nothing else, so a project that never imports it pays nothing',
  },
  {
    from: 'payload-live-preview/react',
    symbol: 'useLivePreviewDocument',
    use: 'export const out = useLivePreviewDocument;',
    gzip: 5_322,
    why: 'the hook: the message bus, the origin detector and the merger, and nothing that touches an element (Vite re-bundles unminified, hence above the 4 637 published bytes)',
  },
  {
    from: 'payload-live-preview/vue',
    symbol: 'useLivePreviewDocument',
    use: 'export const out = useLivePreviewDocument;',
    gzip: 5_311,
    why: 'the composable: the same session as the React hook, with Vue reactivity instead',
  },
  {
    from: 'payload-live-preview/plugins',
    symbol: 'PluginManager',
    use: 'export const out = PluginManager;',
    gzip: 3_372,
    why: 'the plugin manager without the built-in plugins',
  },
];

function slug(fixture: Fixture): string {
  return `${fixture.from.replace(/[^a-z]/gu, '-')}--${fixture.symbol}`;
}

async function bundle(consumer: string, fixture: Fixture): Promise<string> {
  const entry = join(consumer, `${slug(fixture)}.ts`);
  await writeFile(entry, `import { ${fixture.symbol} } from '${fixture.from}';\n${fixture.use}\n`);
  const result = await build({
    root: consumer,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: 'esbuild',
      target: 'es2022',
      lib: { entry, formats: ['es'], fileName: 'out' },
      // The optional peers a fixture must not inline: measuring React would
      // measure React, not what this package ships.
      rollupOptions: { external: ['ts-morph', 'react', 'vue'] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const first = outputs[0];
  if (first === undefined || !('output' in first)) throw new Error('vite produced no output');
  const chunk = first.output.find((item) => item.type === 'chunk');
  if (chunk === undefined) throw new Error(`no chunk for ${slug(fixture)}`);
  return chunk.code;
}

async function main(): Promise<void> {
  const consumer = await mkdtemp(join(tmpdir(), 'payload-live-preview-treeshake-'));
  const failures: string[] = [];
  try {
    // A real consumer: the package resolves through node_modules, so the
    // manifest's `exports` and `sideEffects` apply exactly as they would after
    // `npm install`.
    await mkdir(join(consumer, 'node_modules'));
    await symlink(ROOT, join(consumer, 'node_modules', 'payload-live-preview'), 'dir');
    await writeFile(
      join(consumer, 'package.json'),
      '{ "name": "treeshake-consumer", "type": "module", "private": true }\n',
    );
    for (const fixture of TREE_SHAKING_FIXTURES) {
      const code = await bundle(consumer, fixture);
      const raw = Buffer.byteLength(code);
      const gzip = gzipSync(code, { level: 9 }).byteLength;
      const ok = gzip <= fixture.gzip;
      console.log(
        `${ok ? 'PASS' : 'FAIL'} import { ${fixture.symbol} } from '${fixture.from}': ${String(raw)} raw / ${String(gzip)} gzip (budget ${String(fixture.gzip)}) — ${fixture.why}`,
      );
      const notice = improvementNotice(
        `import { ${fixture.symbol} } from '${fixture.from}'`,
        gzip,
        fixture.gzip,
      );
      if (notice !== undefined) console.log(notice);
      if (!ok) failures.push(`${fixture.from} → ${fixture.symbol}`);
    }
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    throw new Error(`tree-shaking gate failed for ${failures.join(', ')}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
