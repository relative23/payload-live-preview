import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closureBytes,
  entryClosure,
  reexportsOnly,
  staticImports,
} from '../../../scripts/entry-closure';

/**
 * Since 3.0 the built entries share chunks, so the bytes of an entry are its
 * own file and every chunk it loads. The size gate budgets that closure, and
 * both gates accept an empty source map only for a file that has no code.
 */

let folder: string | undefined;

async function build(files: Record<string, string>): Promise<string> {
  folder = await mkdtemp(join(tmpdir(), 'plp-entry-closure-'));
  for (const [name, code] of Object.entries(files)) {
    await mkdir(join(folder, name, '..'), { recursive: true });
    await writeFile(join(folder, name), code);
  }
  return folder;
}

afterEach(async () => {
  if (folder !== undefined) await rm(folder, { recursive: true, force: true });
  folder = undefined;
});

describe('what a built entry loads', () => {
  it('reads the static relative imports as the minifier writes them, and no other specifier', () => {
    expect(
      staticImports(
        'import{a as b}from"./chunk-AAAA.js";export{c}from"../../chunk-BBBB.js";import"./chunk-CCCC.js";' +
          'export*from"./chunk-DDDD.js";import{useRef}from"react";const later=()=>import("./lazy.js");',
      ),
    ).toEqual(['./chunk-AAAA.js', '../../chunk-BBBB.js', './chunk-CCCC.js', './chunk-DDDD.js']);
  });

  it('is the entry and then each chunk where it is first reached, once', async () => {
    const dist = await build({
      'adapters/next/index.js':
        'import{a}from"../../chunk-A.js";import"../../chunk-B.js";export{a};',
      'chunk-A.js': 'import{c}from"./chunk-C.js";export const a=c;',
      'chunk-B.js': 'import{c}from"./chunk-C.js";export const b=c;',
      'chunk-C.js': 'export const c=1;',
      'chunk-D.js': 'export const d=2;',
    });

    const closure = await entryClosure(join(dist, 'adapters/next/index.js'));

    expect(closure.map((file) => file.slice(dist.length + 1))).toEqual([
      'adapters/next/index.js',
      'chunk-A.js',
      'chunk-C.js',
      'chunk-B.js',
    ]);
  });

  it('measures the bytes of those files in that order', async () => {
    const dist = await build({
      'entry.js': 'import"./chunk-A.js";',
      'chunk-A.js': 'export const a=1;',
    });

    expect((await closureBytes(join(dist, 'entry.js'))).toString()).toBe(
      'import"./chunk-A.js";export const a=1;',
    );
  });
});

describe('a built file that only re-exports', () => {
  it.each([
    [
      're-exports and a bare import',
      'export{a,b as c}from"./chunk-A.js";export*from"./chunk-B.js";import"./chunk-C.js";',
    ],
    [
      'the same with the map comment after it',
      'export{a}from"./chunk-A.js";\n//# sourceMappingURL=index.js.map\n',
    ],
    ['nothing at all', ''],
  ])('is %s', (_label, code) => {
    expect(reexportsOnly(code)).toBe(true);
  });

  it.each([
    [
      'a function beside the re-export',
      'export{a}from"./chunk-A.js";function b(){return 1}export{b};',
    ],
    ['a constant', 'export const a=1;'],
    ['an import that is used', 'import{a}from"./chunk-A.js";console.log(a);'],
  ])('is not %s', (_label, code) => {
    expect(reexportsOnly(code)).toBe(false);
  });
});
