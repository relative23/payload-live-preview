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

function policy(output: string, mode?: string, version = '7.3.2') {
  const read = vi.fn((path: string, encoding: string) => {
    expect(encoding).toBe('utf8');
    if (path === resolve('node_modules/astro/package.json')) return JSON.stringify({ version });
    expect(path).toBe(resolve('dist/client/island-csp-probe/index.html'));
    return output;
  });
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
    expect(read.mock.calls).toEqual([
      [resolve('dist/client/island-csp-probe/index.html'), 'utf8'],
      [resolve('node_modules/astro/package.json'), 'utf8'],
    ]);
  });

  it.each([
    [
      '4.16.19',
      'tests/unit/quality/fixtures/astro-island-csp-4.16.19.html.fixture',
      {
        scripts: "'sha256-WN0hqek1jEauhlhWVVXeQPa5BD3f0rsMdmwSZtw1Cys='",
        styles: "'sha256-vv9IoKo7BSLbWcUHr3tNmfNVmm5L/9Cfn2H6LMk7/ow='",
      },
    ],
    [
      '7.3.2',
      'tests/unit/quality/fixtures/astro-island-csp-7.3.2.html.fixture',
      {
        scripts:
          "'sha256-QzWFZi+FLIx23tnm9SBU4aEgx4x8DsuASP07mfqol/c=' 'sha256-Ya0pUYrC7nM5Cn/056TyVuEiz6dFGrzmkWzgON0pF0U='",
        styles: "'sha256-vv9IoKo7BSLbWcUHr3tNmfNVmm5L/9Cfn2H6LMk7/ow='",
      },
    ],
  ])('hashes the retained exact Astro %s compiler output', (version, path, expected) => {
    const output = readFileSync(path, 'utf8');
    expect(policy(output, 'build-hashes', version).get()).toEqual(expected);
  });
  it.each([
    ['4.16.19', '7.3.2'],
    ['7.3.2', '4.16.19'],
    ['5.18.2', '4.16.19'],
    ['6.4.8', '7.3.2'],
  ])('refuses an unreviewed version/shape pair %s/%s', (version, fixtureVersion) => {
    const output = readFileSync(
      `tests/unit/quality/fixtures/astro-island-csp-${fixtureVersion}.html.fixture`,
      'utf8',
    );
    expect(() => policy(output, 'build-hashes', version).get()).toThrow(
      'Unexpected island CSP build shape',
    );
  });
  it.each([
    `<script>${island};${load}</script><style>${style}</style>`,
    `<script>${load};${island}</script><script>extra()</script><style>${style}</style>`,
    `<script>${load};${island}</script><style>${style}</style><style>extra{}</style>`,
    `<script>${load};${island}</script><style>changed{}</style>`,
  ])('refuses changed merged Astro4 bootstraps %#', (output) => {
    expect(() => policy(output, 'build-hashes', '4.16.19').get()).toThrow(
      'Unexpected island CSP build shape',
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
