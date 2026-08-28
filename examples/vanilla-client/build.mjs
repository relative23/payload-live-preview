/**
 * Bundle the SPA entry with esbuild so `payload-live-preview/client` is
 * resolved through the package's exports map exactly as a real consumer's
 * bundler would, then emit the static HTML that loads it.
 */
import { build } from 'esbuild';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'main.js')],
  outfile: join(dist, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
});

const shell = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{margin:0;font:16px/1.5 system-ui,sans-serif}</style>` +
  `<script type="module" src="/app.js"></script></head><body>${body}</body></html>`;

const indexBody =
  '<h1 data-payload-field="title" data-testid="title">Hello</h1>' +
  '<p data-payload-field="subtitle" data-testid="subtitle">sub</p>';

const revealBody =
  '<h1 data-payload-field="heroTitle" data-testid="hero">Top</h1>' +
  '<div style="height:2200px">scroll down for the footer</div>' +
  '<p data-payload-field="footer" data-testid="footer">old footer</p>';

await writeFile(join(dist, 'index.html'), shell('Vanilla client preview', indexBody), 'utf8');
await writeFile(join(dist, 'reveal.html'), shell('Reveal fixture', revealBody), 'utf8');
await copyFile(join(here, 'admin.html'), join(dist, 'admin.html'));
console.log('vanilla-client built to dist/');
