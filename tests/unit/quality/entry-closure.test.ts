import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  boundImports,
  closureBytes,
  entryClosure,
  exportClosureBytes,
  exportSource,
  loadedUnused,
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

describe('a file an entry loads and takes nothing from', () => {
  it('reads the imports that name a binding and the re-exports, and no bare import', () => {
    expect(
      boundImports(
        'import{a as b}from"./chunk-AAAA.js";export{c}from"../../chunk-BBBB.js";import"./chunk-CCCC.js";' +
          'export*from"./chunk-DDDD.js";import*as n from"./chunk-EEEE.js";import{useRef}from"react";',
      ),
    ).toEqual(['./chunk-AAAA.js', '../../chunk-BBBB.js', './chunk-DDDD.js', './chunk-EEEE.js']);
  });

  it('is a chunk reached through bare imports alone, with what only that chunk imports', async () => {
    const dist = await build({
      'entry.js':
        'import{a}from"./chunk-A.js";import"./chunk-SERVER.js";import"./chunk-SHARED.js";export{a};',
      'chunk-A.js': 'import{s}from"./chunk-SHARED.js";export const a=s;',
      // Nothing of the closure takes a binding from these two.
      'chunk-SERVER.js': 'import{d}from"./chunk-DEEP.js";export const authorize=d;',
      'chunk-DEEP.js': 'export const d=1;',
      // Hoisted as a bare import into the entry, and used by chunk-A.
      'chunk-SHARED.js': 'export const s=2;',
    });

    const unused = await loadedUnused(join(dist, 'entry.js'));

    expect(unused.map((file) => file.slice(dist.length + 1))).toEqual([
      'chunk-SERVER.js',
      'chunk-DEEP.js',
    ]);
  });

  it('is nothing for an entry whose every chunk hands it a binding', async () => {
    const dist = await build({
      'entry.js': 'export{a}from"./chunk-A.js";import"./chunk-B.js";',
      'chunk-A.js': 'import{b}from"./chunk-B.js";export const a=b;',
      'chunk-B.js': 'export const b=1;',
    });

    expect(await loadedUnused(join(dist, 'entry.js'))).toEqual([]);
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

describe('what a bundler that takes files whole ships for one export', () => {
  const FILES = {
    'entry.js':
      'export{a as client,b}from"./chunk-BIG.js";export{c as morph}from"./chunk-SMALL.js";import"./chunk-SIDE.js";export{d};const d=4;',
    'chunk-BIG.js': 'import{x}from"./chunk-DEEP.js";const a=1,b=2;export{a,b};',
    'chunk-SMALL.js': 'const c=3;export{c};',
    'chunk-DEEP.js': 'const x=0;export{x};',
    'chunk-SIDE.js': 'const y=9;',
  };

  it('finds the chunk a re-export names, by the name the entry exports', async () => {
    const dist = await build(FILES);

    expect(await exportSource(join(dist, 'entry.js'), 'client')).toBe(join(dist, 'chunk-BIG.js'));
    expect(await exportSource(join(dist, 'entry.js'), 'morph')).toBe(join(dist, 'chunk-SMALL.js'));
    // `a` is the chunk's own name for it, not one the entry exports.
    expect(await exportSource(join(dist, 'entry.js'), 'a')).toBe(join(dist, 'entry.js'));
  });

  it("counts that chunk and what it imports, and none of the entry's other chunks", async () => {
    const dist = await build(FILES);

    expect((await exportClosureBytes(join(dist, 'entry.js'), 'client')).toString()).toBe(
      FILES['chunk-BIG.js'] + FILES['chunk-DEEP.js'],
    );
    expect((await exportClosureBytes(join(dist, 'entry.js'), 'morph')).toString()).toBe(
      FILES['chunk-SMALL.js'],
    );
  });

  it('counts the whole entry for a name the entry defines itself', async () => {
    const dist = await build(FILES);

    expect((await exportClosureBytes(join(dist, 'entry.js'), 'd')).length).toBe(
      Object.values(FILES).join('').length,
    );
  });
});
