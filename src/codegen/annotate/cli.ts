/**
 * `pll-codegen annotate` — the subcommand behind the annotator.
 *
 * Kept apart from `src/codegen/cli.ts` so the flag parser of the generator does
 * not grow a second mode inside itself; the entry dispatches on the first
 * positional and calls this.
 */

import { readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { generateTypes } from '../index';
import { ANNOTATABLE_EXTENSIONS, annotateTemplates, formatAnnotateReport } from './index';

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

export const ANNOTATE_HELP = `pll-codegen annotate — add data-payload-field where a template prints a field

Usage:
  pll-codegen annotate <path...> --config <payload.config.ts> [--write]

Options:
  -c, --config <path>   Path to payload.config.ts (required): the schema decides
                        which paths exist
      --write           Write the annotated files; without it nothing is touched
  -h, --help            Show this help

What it annotates:
  An element whose entire content is one field access — <h1>{page.title}</h1> —
  and whose path the schema has. Astro, JSX and Svelte templates.

What it refuses, with a reason per line:
  a value printed beside other text, a call or an operator, a path the schema
  does not know, an array item inside a loop, and anything already annotated.

Exit codes:
  0  nothing left to do, or the files were written
  1  fatal error
  3  a dry run found work; re-run with --write
`;

export interface AnnotateArgs {
  readonly paths: readonly string[];
  readonly configPath: string | undefined;
  readonly write: boolean;
  readonly showHelp: boolean;
}

export function parseAnnotateArgs(argv: readonly string[]): AnnotateArgs {
  const paths: string[] = [];
  let configPath: string | undefined;
  let write = false;
  let showHelp = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === '-h' || token === '--help') showHelp = true;
    else if (token === '--write') write = true;
    else if (token === '--config' || token === '-c') {
      configPath = argv[index + 1];
      index += 1;
    } else if (token.startsWith('--config=')) configPath = token.slice('--config='.length);
    else if (!token.startsWith('-')) paths.push(token);
  }
  return { paths, configPath, write, showHelp };
}

/** Every annotatable template under the given files and directories. */
export async function collectTemplates(paths: readonly string[]): Promise<readonly string[]> {
  const found: string[] = [];
  for (const path of paths) {
    const absolute = resolve(path);
    const stats = await stat(absolute);
    if (stats.isDirectory()) found.push(...(await walk(absolute)));
    else if (ANNOTATABLE_EXTENSIONS.includes(extname(absolute))) found.push(absolute);
  }
  return found.sort();
}

async function walk(directory: string): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...(await walk(join(directory, entry.name))));
    } else if (ANNOTATABLE_EXTENSIONS.includes(extname(entry.name))) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

export interface AnnotateCliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export async function runAnnotate(argv: readonly string[], io: AnnotateCliIo): Promise<number> {
  const args = parseAnnotateArgs(argv);
  if (args.showHelp) {
    io.out(ANNOTATE_HELP);
    return 0;
  }
  if (args.configPath === undefined || args.paths.length === 0) {
    io.err('pll-codegen annotate: --config and at least one path are required.\n');
    return 1;
  }
  try {
    // The schema, not a heuristic, decides which paths exist; `generateTypes`
    // already knows how to read it, and its inventory is the same list the
    // runtime resolves bindings against.
    const { inventory } = await generateTypes({ configPath: args.configPath });
    const files = await collectTemplates(args.paths);
    if (files.length === 0) {
      io.err(`pll-codegen annotate: no ${ANNOTATABLE_EXTENSIONS.join(', ')} files found.\n`);
      return 1;
    }
    const result = await annotateTemplates({ files, inventory, write: args.write });
    io.out(formatAnnotateReport(result));
    if (!args.write && result.annotationCount > 0) return 3;
    return 0;
  } catch (error) {
    io.err(`pll-codegen annotate: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
