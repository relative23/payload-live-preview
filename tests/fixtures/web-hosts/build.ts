/**
 * Bundles each runtime's entry with the handler and the package's Next.js entry
 * into one file per host, `node.mjs`, `deno.mjs` and `bun.mjs`. The package entry
 * resolves to this checkout's build, so run `npm run build` first.
 */
import { build, type BuildOptions } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'test-results/web-hosts');
mkdirSync(out, { recursive: true });
const shared: BuildOptions = {
  bundle: true,
  format: 'esm',
  mainFields: ['module', 'main'],
  alias: { 'payload-live-preview/nextjs': resolve('dist/adapters/nextjs/index.js') },
  outdir: out,
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
};
await build({
  ...shared,
  platform: 'node',
  entryPoints: { node: 'tests/fixtures/web-hosts/node.ts' },
});
await build({
  ...shared,
  platform: 'neutral',
  entryPoints: { deno: 'tests/fixtures/web-hosts/deno.ts', bun: 'tests/fixtures/web-hosts/bun.ts' },
});
console.log(out);
