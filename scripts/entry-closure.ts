/**
 * What an entry of the built package loads: its own file and every chunk it
 * reaches through a static relative import. Since 3.0 the entries share chunks
 * (ADR 0012), so the bytes of an entry are the bytes of this closure, and a
 * budget on the entry's own file would measure a list of imports.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** `import … from "./x.js"`, `export … from "./x.js"` and a bare `import "./x.js"`, as the minifier writes them. */
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/gu;

/** The relative specifiers a built module imports statically. */
export function staticImports(code: string): readonly string[] {
  return [...code.matchAll(STATIC_IMPORT)].map((match) => match[1]!);
}

/** `… from "./x.js"`: an import that names a binding, or a re-export. A bare `import "./x.js"` is not one. */
const BOUND_IMPORT = /\bfrom\s*["'](\.{1,2}\/[^"']+)["']/gu;

/** The relative specifiers a built module takes a binding from, a re-export included. */
export function boundImports(code: string): readonly string[] {
  return [...code.matchAll(BOUND_IMPORT)].map((match) => match[1]!);
}

/** The files reached from `entry` through the imports `read` finds, the entry first. */
async function reachedThrough(
  entry: string,
  read: (code: string) => readonly string[],
): Promise<readonly string[]> {
  const seen = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of read(await readFile(file, 'utf8'))) {
      await visit(resolve(dirname(file), specifier));
    }
  };
  await visit(resolve(entry));
  return [...seen];
}

/**
 * The files of an entry's closure, the entry first and then each chunk where
 * it is first reached, as absolute paths. The order is the build's, so the
 * same build measures the same bytes.
 */
export async function entryClosure(entry: string): Promise<readonly string[]> {
  return reachedThrough(entry, staticImports);
}

/**
 * The files of an entry's closure that it loads and takes nothing from: they
 * are reached through bare imports alone, so no module of the closure uses a
 * binding of theirs. The package declares no side effects, so such a file is
 * bytes a page without a bundler fetches for nothing. An entry that takes a
 * name through a barrel gets one for every other module the barrel names.
 */
export async function loadedUnused(entry: string): Promise<readonly string[]> {
  const used = new Set(await reachedThrough(entry, boundImports));
  return (await entryClosure(entry)).filter((file) => !used.has(file));
}

/** The closure's bytes in that order, which is what a budget measures. */
export async function closureBytes(entry: string): Promise<Buffer> {
  const files = await entryClosure(entry);
  return Buffer.concat(await Promise.all(files.map((file) => readFile(file))));
}

/** `export{a as b,c}from"./x.js"`, as the minifier writes it: the list and the specifier. */
const NAMED_REEXPORT = /\bexport\s*\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/gu;

/**
 * The file an entry takes one export from: the chunk its re-export names, or
 * the entry itself where it defines the name. A bundler that takes a file
 * whole once one export of it is used (webpack, Turbopack) ships that file
 * and everything it imports, whatever else the entry exports.
 */
export async function exportSource(entry: string, name: string): Promise<string> {
  const file = resolve(entry);
  for (const [, list, specifier] of (await readFile(file, 'utf8')).matchAll(NAMED_REEXPORT)) {
    const exported = (list ?? '').split(',').map((part) =>
      part
        .trim()
        .split(/\s+as\s+/u)
        .at(-1),
    );
    if (exported.includes(name)) return resolve(dirname(file), specifier!);
  }
  return file;
}

/** The bytes such a bundler takes for one export of an entry: the closure of the file it comes from. */
export async function exportClosureBytes(entry: string, name: string): Promise<Buffer> {
  return closureBytes(await exportSource(entry, name));
}

/**
 * Whether a built module is nothing but imports and re-exports of other
 * modules. Such an entry has no line of its own, so its source map lists no
 * source: the gates take that for a missing map only where the file has code.
 */
export function reexportsOnly(code: string): boolean {
  return (
    code
      .replace(/^\/\/# sourceMappingURL=.*$/gmu, '')
      .replace(/\b(?:import|export)\b[^;'"]*\bfrom\s*["'][^"']+["']\s*;?/gu, '')
      .replace(/\bimport\s*["'][^"']+["']\s*;?/gu, '')
      .trim() === ''
  );
}
