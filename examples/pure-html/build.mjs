/**
 * No framework, no bundler: bake the inline runtime into static HTML with
 * generateInlineScript() — the SSR-agnostic delivery path. Proves the package
 * works on a plain HTML page, the baseline every other stack builds on.
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateInlineScript } from 'payload-live-preview';
import { LEAN_RUNTIME } from 'payload-live-preview/lean';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const ORIGIN = 'http://localhost:4180';

const options = {
  allowedOrigins: [ORIGIN, 'http://127.0.0.1:4180'],
  debug: true,
  debounceMs: 25,
  revealEditedField: true,
};

const inline = generateInlineScript(options);
// The lean artifact: same options, fewer features baked in. `lean.html` is what
// `tests/e2e/specs/lean-profile.spec.ts` measures and drives.
const lean = generateInlineScript({ ...options, runtime: LEAN_RUNTIME });

const shell = (title, body, script = inline) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{margin:0;font:16px/1.5 system-ui,sans-serif}</style>` +
  `<script>${script}</script></head><body>${body}</body></html>`;

const indexBody =
  '<h1 data-payload-field="title" data-testid="title">Hello</h1>' +
  '<p data-payload-field="subtitle" data-testid="subtitle">sub</p>';

const revealBody =
  '<h1 data-payload-field="heroTitle" data-testid="hero">Top</h1>' +
  '<div style="height:2200px">scroll down for the footer</div>' +
  '<p data-payload-field="footer" data-testid="footer">old footer</p>';

// One page per profile, same markup: what differs in the browser is the runtime.
const leanBody =
  indexBody +
  '<ul data-payload-field="tags" data-payload-type="array" ' +
  'data-payload-array-template="<li>{{value}}</li>" data-testid="tags"><li>one</li></ul>';

await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), shell('Pure HTML preview', indexBody), 'utf8');
await writeFile(join(dist, 'reveal.html'), shell('Reveal fixture', revealBody), 'utf8');
await writeFile(join(dist, 'lean.html'), shell('Lean profile', leanBody, lean), 'utf8');
await writeFile(join(dist, 'full.html'), shell('Full profile', leanBody), 'utf8');
await copyFile(join(here, 'admin.html'), join(dist, 'admin.html'));
console.log(`pure-html built to dist/ (inline ${inline.length} bytes, lean ${lean.length} bytes)`);
