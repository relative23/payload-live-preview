/**
 * Exercise the exact isolated fixture policy, not a copied CSP algorithm.
 * Only fixed build output can authorize native bootstrap content; malformed
 * output and unknown deployment modes must never broaden the policy.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const code = transpileModule(
  readFileSync('tests/fixtures/astro-react-islands/src/server/island-csp.ts.fixture', 'utf8'),
  { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
).outputText;
const load = 'window.dispatchEvent(new Event("astro:load"))';
const island = 'customElements.get("astro-island")';
const style = 'astro-island,astro-slot,astro-static-slot{display:contents}';
const html = `<script>${load}</script><script>${island}</script><style>${style}</style>`;

function policy(output: string, mode?: string) {
  const read = vi.fn(() => output);
  const module = { exports: {} as { islandCsp: () => { scripts: string; styles: string } } };
  runInNewContext(code, {
    module,
    exports: module.exports,
    process: { env: { PLP_ASTRO_ISLAND_CSP: mode } },
    require: (name: string) => {
      if (name === 'node:crypto') return { createHash };
      if (name === 'node:fs') return { readFileSync: read };
      if (name === 'node:path') return { resolve };
      throw new Error('Unexpected policy dependency: ' + name);
    },
  });
  return { get: module.exports.islandCsp, read };
}

describe('fixed build island CSP', () => {
  it.each([undefined, 'unknown', 'unsafe-inline'])('keeps self-only for mode %s', (mode) => {
    const { get, read } = policy(html, mode);
    expect(get()).toEqual({ scripts: '', styles: '' });
    expect(read).not.toHaveBeenCalled();
  });
  it('hashes only the fixed compiler file and caches its immutable result', () => {
    const { get, read } = policy(html, 'build-hashes');
    const hash = (value: string) =>
      "'sha256-" + createHash('sha256').update(value).digest('base64') + "'";
    const result = get();
    expect(result).toEqual({ scripts: [hash(load), hash(island)].join(' '), styles: hash(style) });
    expect(get()).toBe(result);
    expect(read).toHaveBeenCalledExactlyOnceWith(
      resolve('dist/client/island-csp-probe/index.html'),
      'utf8',
    );
  });
  it.each([
    '',
    html.replace(`<script>${load}</script>`, ''),
    html + '<script>extra()</script>',
    html.replace('astro:load', 'wrong-directive'),
    html.replace('astro-island', 'other-island'),
    html.replace('display:contents', 'display:none'),
    html + '<style>extra{}</style>',
    ' '.repeat(40_001),
  ])('refuses a changed fixed build shape %#', (output) => {
    expect(() => policy(output, 'build-hashes').get()).toThrow('Unexpected island CSP build');
  });
});
