/**
 * Chunk boundaries of the build. esbuild puts a module into the chunk of the
 * set of entries that reach it, so the entry table is also the chunking: two
 * features that only the root and `./client` reach are one file. Rollup,
 * Rolldown and esbuild drop what a project does not use inside a file; webpack
 * and Turbopack take a file whole once one export of it is used. So every
 * module that defines a name the root exports is built as an entry of its own,
 * which draws a boundary around it, and `scripts/build-dist.ts` removes that
 * entry's file again: nothing imports it (ADR 0012, ADR 0007 row 46).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The folder under `dist/` the boundary entries are built into, and removed with. */
export const BOUNDARY_DIRECTORY = 'boundary';

interface Reexport {
  /** `undefined` for `export *`; otherwise the exported name and the name the source has for it. */
  readonly names: readonly { readonly exported: string; readonly local: string }[] | undefined;
  readonly source: string;
}

const REEXPORT = /export\s+(type\s+)?(?:\*|\{([^}]*)\})\s+from\s+'([^']+)'\s*;?/gu;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;

/** The value re-exports of a module; a type costs no byte and draws no boundary. */
function valueReexports(text: string): readonly Reexport[] {
  const found: Reexport[] = [];
  for (const [, typeOnly, list, source] of text.replace(COMMENT, '').matchAll(REEXPORT)) {
    if (typeOnly !== undefined || source === undefined) continue;
    if (list === undefined) {
      found.push({ names: undefined, source });
      continue;
    }
    const names = list
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '' && !part.startsWith('type '))
      .map((part) => {
        const [local = '', exported] = part.split(/\s+as\s+/u);
        return { exported: exported ?? local, local };
      });
    if (names.length > 0) found.push({ names, source });
  }
  return found;
}

/** Whether a module is nothing but re-exports: a barrel or an entry, which defines no name itself. */
function reexportsOnly(text: string): boolean {
  return text.replace(COMMENT, '').replace(REEXPORT, '').trim() === '';
}

/** The `@name/*` aliases of `tsconfig.json`, as the folder each one stands for. */
const ALIASES: readonly (readonly [string, string])[] = Object.entries(
  (
    JSON.parse(
      readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gmu, ''),
    ) as { compilerOptions: { paths: Record<string, readonly string[]> } }
  ).compilerOptions.paths,
)
  .filter(([alias]) => alias.endsWith('/*'))
  .map(([alias, targets]) => [alias.slice(0, -1), (targets[0] ?? '').slice(0, -1)] as const)
  // The longest first: `@/` stands for all of `src/` and is the prefix of none of the others.
  .sort(([a], [b]) => b.length - a.length);

/** The source file a specifier names: relative, or under one of those aliases. */
function locate(from: string, specifier: string): string | undefined {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  const base = specifier.startsWith('.')
    ? resolve(dirname(from), specifier)
    : alias === undefined
      ? undefined
      : resolve(ROOT, alias[1], specifier.slice(alias[0].length));
  if (base === undefined) return undefined;
  return [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find((file) => existsSync(file));
}

/**
 * The modules that define the values an entry exports, as paths from the
 * repository root: its re-exports followed through every module that only
 * re-exports, by the names each step takes.
 */
export function definingModules(entry: string): readonly string[] {
  const found = new Set<string>();
  const visit = (file: string, wanted: ReadonlySet<string> | undefined): void => {
    const text = readFileSync(file, 'utf8');
    if (!reexportsOnly(text)) {
      found.add(relative(ROOT, file));
      return;
    }
    for (const { names, source } of valueReexports(text)) {
      const target = locate(file, source);
      if (target === undefined) continue;
      if (names === undefined) {
        visit(target, wanted);
        continue;
      }
      const taken =
        wanted === undefined ? names : names.filter((name) => wanted.has(name.exported));
      if (taken.length > 0) visit(target, new Set(taken.map((name) => name.local)));
    }
  };
  visit(resolve(ROOT, entry), undefined);
  return [...found].sort();
}

/** The boundary entries of the build: `boundary/<module path without src/ and extension>` to its source. */
export function chunkBoundaries(entry = 'src/index.ts'): Readonly<Record<string, string>> {
  return Object.fromEntries(
    definingModules(entry).map((source) => [
      `${BOUNDARY_DIRECTORY}/${source.replace(/^src\//u, '').replace(/\.tsx?$/u, '')}`,
      source,
    ]),
  );
}
