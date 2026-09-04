/** The file walker behind `pll migrate`: find source files, apply the codemods, report or write. */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { migrateSource } from './index';
import type { CodemodConflict, CodemodEdit } from './types';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.astro',
  '.svelte',
  '.vue',
]);
const DECLARATION_FILE = /\.d\.[cm]?ts$/u;
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
  /** What a codemod could not rewrite safely in this file. */
  readonly conflicts: readonly CodemodConflict[];
}

export interface MigrateRunResult {
  readonly files: readonly MigrateFileResult[];
  /** Files the run changed (or would change, in dry-run). */
  readonly changedCount: number;
  /** Codemod id → number of files it touched. */
  readonly byCodemod: Readonly<Record<string, number>>;
  /** Files needing manual attention. */
  readonly conflictCount: number;
}

export interface MigrateOptions {
  /** Apply and save; without it the run only reports. */
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

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(name)) && !DECLARATION_FILE.test(name);
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) await walk(path);
      } else if (isSourceFile(entry.name)) {
        found.push(path);
      }
    }
  }
  const info = await stat(root);
  if (info.isDirectory()) await walk(root);
  else if (isSourceFile(root)) found.push(root);
  return found.sort();
}

function relativeTo(root: string, file: string): string {
  const rel = relative(root, file);
  return rel.length === 0 ? file : rel;
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
  const results: MigrateFileResult[] = [];
  const byCodemod: Record<string, number> = {};
  for (const file of await io.list(root)) {
    const source = await io.read(file);
    const { output, edits, conflicts } = migrateSource(source, {
      fileName: file,
      ...(options.only === undefined ? {} : { only: options.only }),
    });
    const changed = output !== source;
    if (changed && options.write === true) await io.write(file, output);
    if (changed) {
      for (const edit of edits) byCodemod[edit.codemod] = (byCodemod[edit.codemod] ?? 0) + 1;
    }
    results.push({ file: relativeTo(root, file), edits, changed, conflicts });
  }
  return {
    files: results,
    changedCount: results.filter((result) => result.changed).length,
    byCodemod,
    conflictCount: results.filter((result) => result.conflicts.length > 0).length,
  };
}
