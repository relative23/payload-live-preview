/**
 * Which exported names the consumers this repository can read actually use.
 *
 * The API reports list what each entry exports; nothing says which of those a
 * project needs. The two consumers that can be read are the examples under
 * `examples/` (what a project imports) and the documentation (what a reader
 * is told to write). A name neither imports nor mentions is a name the
 * package carries for its own tests and modules, and the `@internal` split
 * in the reports rests on this measurement rather than on a feeling.
 *
 * `npx tsx scripts/surface-usage.ts` prints the split; `--json` prints the
 * per-name detail for a script to consume.
 */

import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const API_REPORTS = resolve(ROOT, 'etc/api');
const PACKAGE_NAME = 'payload-live-preview';

const EXAMPLE_SOURCE = /\.(?:[cm]?[jt]sx?|astro|vue|svelte|html)$/u;
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.output',
  '.vercel',
]);

export interface NameUsage {
  /** Example files that import the name, with the entry they import it from. */
  readonly examples: readonly string[];
  /** Documentation files that name it in a code span or fence. */
  readonly docs: readonly string[];
}

export interface SurfaceUsage {
  /** Report file → exported name → where it is used. */
  readonly entries: Readonly<Record<string, Readonly<Record<string, NameUsage>>>>;
}

/** The names one API report exports, in report order. */
export function exportedNames(report: string): readonly string[] {
  const names: string[] = [];
  for (const line of report.split('\n')) {
    const declared =
      /^export (?:declare )?(?:abstract )?(?:const|let|var|function|class|interface|type|enum|namespace) ([A-Za-z_$][\w$]*)/u.exec(
        line,
      );
    if (declared?.[1] !== undefined) {
      names.push(declared[1]);
      continue;
    }
    const reExported = /^export \{ ([A-Za-z_$][\w$]*)(?: as ([A-Za-z_$][\w$]*))? \}/u.exec(line);
    if (reExported !== null) {
      names.push(reExported[2] ?? reExported[1] ?? '');
      continue;
    }
    // The Nuxt module: loaded by specifier from `modules: []`, never imported by name.
    if (line.startsWith('export default ')) names.push('default');
  }
  return names;
}

/** Report file name for a specifier: `payload-live-preview/astro` → `payload-live-preview--astro.api.md`. */
export function reportFor(specifier: string): string {
  const suffix = specifier.slice(PACKAGE_NAME.length);
  return `${PACKAGE_NAME}${suffix.replaceAll('/', '--')}.api.md`;
}

/** `import { a, type b, c as d } from 'payload-live-preview/x'` → `[report, [a, b, c]]`. */
export function importsIn(source: string): readonly (readonly [string, readonly string[]])[] {
  const found: (readonly [string, readonly string[]])[] = [];
  const pattern = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"](${PACKAGE_NAME}(?:/[\\w/-]+)?)['"]`,
    'gu',
  );
  for (const match of source.matchAll(pattern)) {
    const names = (match[1] ?? '')
      .split(',')
      .map(
        (part) =>
          part
            .trim()
            .replace(/^type\s+/u, '')
            .split(/\s+as\s+/u)[0] ?? '',
      )
      .filter((name) => name.length > 0);
    found.push([reportFor(match[2] ?? PACKAGE_NAME), names]);
  }
  return found;
}

/** Inline code spans and fenced blocks: where a reader copies a name from. */
export function codeSpans(markdown: string): string {
  const fences = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map((m) => m[1] ?? '');
  const withoutFences = markdown.replace(/```[^\n]*\n[\s\S]*?```/gu, '');
  const inline = [...withoutFences.matchAll(/`([^`\n]+)`/gu)].map((m) => m[1] ?? '');
  return [...fences, ...inline].join('\n');
}

async function walk(directory: string, accept: (name: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...(await walk(path, accept)));
    } else if (entry.isFile() && accept(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

export async function measureSurfaceUsage(repositoryRoot = ROOT): Promise<SurfaceUsage> {
  const reports = new Map<string, readonly string[]>();
  for (const file of (await readdir(resolve(repositoryRoot, 'etc/api'))).sort()) {
    if (!file.endsWith('.api.md')) continue;
    reports.set(file, exportedNames(await readFile(resolve(API_REPORTS, file), 'utf8')));
  }

  const exampleUses = new Map<string, Set<string>>();
  for (const file of await walk(resolve(repositoryRoot, 'examples'), (name) =>
    EXAMPLE_SOURCE.test(name),
  )) {
    const source = await readFile(file, 'utf8');
    for (const [report, names] of importsIn(source)) {
      for (const name of names) {
        const key = `${report}::${name}`;
        const uses = exampleUses.get(key) ?? new Set<string>();
        uses.add(relative(repositoryRoot, file));
        exampleUses.set(key, uses);
      }
    }
  }

  // `docs/audit.md` names the core's internals in order to describe them,
  // not to hand them to a project; counting it would make an audit of a name
  // the reason the name is public.
  const docFiles = [
    resolve(repositoryRoot, 'README.md'),
    ...(await walk(
      resolve(repositoryRoot, 'docs'),
      (name) => name.endsWith('.md') && !name.startsWith('PRIVATE-') && name !== 'audit.md',
    )),
  ];
  const docCode = new Map<string, string>();
  for (const file of docFiles) {
    docCode.set(relative(repositoryRoot, file), codeSpans(await readFile(file, 'utf8')));
  }

  const entries: Record<string, Record<string, NameUsage>> = {};
  for (const [report, names] of reports) {
    const perName: Record<string, NameUsage> = {};
    for (const name of names) {
      // A default export has no name a guide could show; the word is everywhere.
      const pattern =
        name === 'default' ? undefined : new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'u');
      const docs =
        pattern === undefined
          ? []
          : [...docCode].filter(([, code]) => pattern.test(code)).map(([file]) => file);
      perName[name] = {
        examples: [...(exampleUses.get(`${report}::${name}`) ?? [])].sort(),
        docs,
      };
    }
    entries[report] = perName;
  }
  return { entries };
}

export interface SurfaceSplit {
  readonly total: number;
  readonly importedByExamples: number;
  readonly namedInDocs: number;
  readonly used: number;
  readonly unused: number;
  /** Distinct names (a name exported from several entries counts once). */
  readonly distinct: { readonly total: number; readonly used: number };
}

export function splitSurface(usage: SurfaceUsage): SurfaceSplit {
  let total = 0;
  let importedByExamples = 0;
  let namedInDocs = 0;
  let used = 0;
  const distinctAll = new Set<string>();
  const distinctUsed = new Set<string>();
  for (const names of Object.values(usage.entries)) {
    for (const [name, use] of Object.entries(names)) {
      total += 1;
      distinctAll.add(name);
      const inExamples = use.examples.length > 0;
      const inDocs = use.docs.length > 0;
      if (inExamples) importedByExamples += 1;
      if (inDocs) namedInDocs += 1;
      if (inExamples || inDocs) {
        used += 1;
        distinctUsed.add(name);
      }
    }
  }
  return {
    total,
    importedByExamples,
    namedInDocs,
    used,
    unused: total - used,
    distinct: { total: distinctAll.size, used: distinctUsed.size },
  };
}

async function main(): Promise<void> {
  const usage = await measureSurfaceUsage();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(usage, null, 2));
    return;
  }
  const split = splitSurface(usage);
  console.log(
    `Surface usage: ${String(split.total)} declarations across ${String(Object.keys(usage.entries).length)} reports; ` +
      `${String(split.importedByExamples)} imported by an example, ${String(split.namedInDocs)} named in the docs, ` +
      `${String(split.used)} used either way, ${String(split.unused)} by neither ` +
      `(${String(split.distinct.used)} of ${String(split.distinct.total)} distinct names).`,
  );
  for (const [report, names] of Object.entries(usage.entries)) {
    const all = Object.keys(names).length;
    const usedHere = Object.values(names).filter(
      (use) => use.examples.length > 0 || use.docs.length > 0,
    ).length;
    console.log(`  ${report.padEnd(52)} ${String(usedHere).padStart(3)} / ${String(all)}`);
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
