/**
 * Tree shaking, measured (roadmap 1.4.0). A consumer that imports one symbol
 * must ship that symbol's code, not the barrel it came from. Each fixture is
 * a one-line consumer bundled with Vite — the bundler behind Astro, SvelteKit
 * and Nuxt — resolving `payload-live-preview` the way a real install does
 * (through `exports` and `sideEffects`), minified, and held to a gzip budget
 * like every other artefact.
 *
 * Runs after the build: `npm run test:treeshake`. Budgets are measured sizes
 * with ~1.5 % headroom; lower them when a measurement drops, raise them with
 * the reason recorded.
 *
 * @module scripts/check-tree-shaking
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

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

/** Measured 2026-08-27; headroom ~1.5 %. */
export const TREE_SHAKING_FIXTURES: readonly Fixture[] = [
  {
    from: 'payload-live-preview',
    symbol: 'escapeHtml',
    use: 'export const out = escapeHtml(String(Date.now()));',
    gzip: 250,
    why: 'a pure helper from the root barrel: the barrel itself costs nothing',
  },
  {
    from: 'payload-live-preview',
    symbol: 'lexicalToHtml',
    use: 'export const out = lexicalToHtml({ root: { children: [] } });',
    gzip: 4_350,
    why: 'the Lexical renderer from the root barrel, on par with payload-live-preview/lexical',
  },
  {
    from: 'payload-live-preview',
    symbol: 'initLivePreview',
    use: 'export const out = initLivePreview({});',
    gzip: 32_800,
    why: 'the client with its built-in renderers from the root barrel, on par with payload-live-preview/client',
  },
  {
    from: 'payload-live-preview',
    symbol: 'generateInlineScript',
    use: 'export const out = generateInlineScript({});',
    gzip: 30_550,
    why: 'the generator carries the inline runtime source and nothing of the client',
  },
  {
    from: 'payload-live-preview/core',
    symbol: 'initLivePreview',
    use: 'export const out = initLivePreview({});',
    gzip: 32_800,
    why: 'the client from the core entry: the same code, the same size',
  },
  {
    from: 'payload-live-preview/lexical',
    symbol: 'lexicalToHtml',
    use: 'export const out = lexicalToHtml({ root: { children: [] } });',
    gzip: 4_450,
    why: 'the Lexical renderer from its focused entry',
  },
  {
    from: 'payload-live-preview/structural',
    symbol: 'morphElement',
    use: 'export const out = morphElement(document.body, document.body, { keyAttributes: [] });',
    gzip: 1_200,
    why: 'the keyed morph alone, without the array renderer',
  },
  {
    from: 'payload-live-preview/plugins',
    symbol: 'PluginManager',
    use: 'export const out = PluginManager;',
    gzip: 3_700,
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
      rollupOptions: { external: ['ts-morph'] },
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
