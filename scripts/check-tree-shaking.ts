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
import { TREE_SHAKING_FIXTURES, type Fixture } from './tree-shaking-budgets';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
