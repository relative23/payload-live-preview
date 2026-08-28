/**
 * No framework, no bundler: bake the inline runtime into static HTML with
 * generateInlineScript() — the SSR-agnostic delivery path. Proves the package
 * works on a plain HTML page, the baseline every other stack builds on.
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateInlineScript } from 'payload-live-preview';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const ORIGIN = 'http://localhost:4180';

const inline = generateInlineScript({
  allowedOrigins: [ORIGIN, 'http://127.0.0.1:4180'],
  debug: true,
  debounceMs: 25,
  revealEditedField: true,
});

const shell = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{margin:0;font:16px/1.5 system-ui,sans-serif}</style>` +
  `<script>${inline}</script></head><body>${body}</body></html>`;

const indexBody =
  '<h1 data-payload-field="title" data-testid="title">Hello</h1>' +
  '<p data-payload-field="subtitle" data-testid="subtitle">sub</p>';

const revealBody =
  '<h1 data-payload-field="heroTitle" data-testid="hero">Top</h1>' +
  '<div style="height:2200px">scroll down for the footer</div>' +
  '<p data-payload-field="footer" data-testid="footer">old footer</p>';

await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), shell('Pure HTML preview', indexBody), 'utf8');
await writeFile(join(dist, 'reveal.html'), shell('Reveal fixture', revealBody), 'utf8');
await copyFile(join(here, 'admin.html'), join(dist, 'admin.html'));
console.log('pure-html built to dist/');
