/**
 * The file walker behind `pll migrate`: find source files, apply the
 * codemods, and report or write the result. Kept apart from the codemods
 * (`@migrate/index`) so those stay pure and testable without a filesystem.
 *
 * @module @migrate/runner
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { migrateSource, type CodemodEdit } from './index';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.astro',
  '.svelte',
  '.vue',
]);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.astro',
  '.svelte-kit',
  '.next',
  '.nuxt',
  'coverage',
]);

export interface MigrateFileResult {
  readonly file: string;
  readonly edits: readonly CodemodEdit[];
  readonly changed: boolean;
}

export interface MigrateRunResult {
  readonly files: readonly MigrateFileResult[];
  /** Files the run changed (or would change, in dry-run). */
  readonly changedCount: number;
  /** Codemod id → number of files it touched. */
  readonly byCodemod: Readonly<Record<string, number>>;
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) await walk(path);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        found.push(path);
      }
    }
  }
  const info = await stat(root);
  if (info.isDirectory()) await walk(root);
  else if (SOURCE_EXTENSIONS.has(extname(root))) found.push(root);
  return found.sort();
}

export interface MigrateOptions {
  /** Apply and save; without it the run only reports (dry-run). */
  readonly write?: boolean;
  /** Restrict to these codemod ids. */
  readonly only?: readonly string[];
  /** Reader/writer injection for tests. */
  readonly io?: {
    readonly read: (path: string) => Promise<string>;
    readonly write: (path: string, content: string) => Promise<void>;
    readonly list: (root: string) => Promise<readonly string[]>;
  };
}

/** Migrate every source file under `root`. */
export async function runMigrate(
  root: string,
  options: MigrateOptions = {},
): Promise<MigrateRunResult> {
  const io = options.io ?? {
    read: (path) => readFile(path, 'utf8'),
    write: (path, content) => writeFile(path, content, 'utf8'),
    list: collectFiles,
  };
  const files = await io.list(root);
  const results: MigrateFileResult[] = [];
  const byCodemod: Record<string, number> = {};
  for (const file of files) {
    const source = await io.read(file);
    const { output, edits } = migrateSource(
      source,
      options.only === undefined ? {} : { only: options.only },
    );
    const changed = output !== source;
    if (changed && options.write === true) await io.write(file, output);
    if (changed) {
      for (const edit of edits) byCodemod[edit.codemod] = (byCodemod[edit.codemod] ?? 0) + 1;
    }
    results.push({ file: relativeTo(root, file), edits, changed });
  }
  return {
    files: results,
    changedCount: results.filter((result) => result.changed).length,
    byCodemod,
  };
}

function relativeTo(root: string, file: string): string {
  const rel = relative(root, file);
  return rel.length === 0 ? file : rel;
}
