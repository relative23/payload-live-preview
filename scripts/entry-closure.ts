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

/**
 * The files of an entry's closure, the entry first and then each chunk where
 * it is first reached, as absolute paths. The order is the build's, so the
 * same build measures the same bytes.
 */
export async function entryClosure(entry: string): Promise<readonly string[]> {
  const seen = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of staticImports(await readFile(file, 'utf8'))) {
      await visit(resolve(dirname(file), specifier));
    }
  };
  await visit(resolve(entry));
  return [...seen];
}

/** The closure's bytes in that order, which is what a budget measures. */
export async function closureBytes(entry: string): Promise<Buffer> {
  const files = await entryClosure(entry);
  return Buffer.concat(await Promise.all(files.map((file) => readFile(file))));
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
