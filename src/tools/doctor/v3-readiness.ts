/**
 * `pll doctor --v3 <path>`: read a project's source and list, by row of the
 * ADR 0007 ledger, the calls of the package whose behaviour 3.0 changes.
 *
 * It reads what is written: a call of a function the file imports from the
 * package, with options given as a literal, as a `const` of the same file or
 * as a `const` a relative import names. A call whose options come from
 * anywhere else is listed as not read, so an empty list never means more than
 * it says. Nothing is rewritten; `pll migrate` does that for the renames.
 */
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import type { Node, SourceFile } from 'ts-morph';
import { loadTsMorph, packageBindings, parseScript, referencesTo } from '../migrate/ast';
import { importsThisPackage, lineNumberAt } from '../migrate/migrate-source';
import { collectFiles } from '../migrate/runner';
import { scriptBlocks } from '../migrate/script-blocks';
import {
  declaredOptions,
  optionFacts,
  relativeImports,
  type OptionFacts,
  type RelativeImport,
} from './v3-options';
import { judgeCall, V3_RULES, type V3Rule } from './v3-rules';

/** One call in the source, by file and line. */
export interface V3Place {
  /** Relative to the path that was read. */
  readonly file: string;
  readonly line: number;
  /** The function or class that is called, as the package exports it. */
  readonly call: string;
}

export interface V3Report {
  /** The path that was read. */
  readonly root: string;
  /** Files that import the package. */
  readonly files: number;
  /** The rules that found a place, in ledger order. */
  readonly rows: readonly { readonly rule: V3Rule; readonly places: readonly V3Place[] }[];
  /** Calls whose options could not be followed, once each. */
  readonly unread: readonly V3Place[];
}

export interface V3Options {
  /** Reader injection for tests. */
  readonly io?: {
    readonly list: (root: string) => Promise<readonly string[]>;
    readonly read: (path: string) => Promise<string>;
  };
}

/** What a relative specifier may stand for, in the order a bundler tries them. */
const MODULE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.js',
  '.jsx',
  '.mjs',
  '/index.ts',
  '/index.js',
];

/** The files `./options.js` can mean; TypeScript writes the emitted name for a `.ts` source. */
function candidates(from: string, specifier: string): string[] {
  const base = join(dirname(from), specifier);
  const emitted = /\.[cm]?js$/u.exec(base)?.[0];
  const typed =
    emitted === undefined
      ? []
      : [`${base.slice(0, -emitted.length)}${emitted.replace('js', 'ts')}`];
  return [...typed, ...MODULE_SUFFIXES.map((suffix) => `${base}${suffix}`)].filter(
    (path) => extname(path) !== '',
  );
}

interface FoundCall {
  readonly name: string;
  readonly entry: string;
  readonly line: number;
  readonly args: readonly Node[];
}

/** Every call or `new` of a name the script binds from the package. */
function callsIn(script: SourceFile): FoundCall[] {
  const { Node } = loadTsMorph();
  const found: FoundCall[] = [];
  for (const binding of packageBindings(script)) {
    for (const reference of referencesTo(script, binding)) {
      const call = reference.node.getParent();
      if (reference.kind !== 'reference') continue;
      if (!Node.isCallExpression(call) && !Node.isNewExpression(call)) continue;
      if (call.getExpression() !== reference.node) continue;
      found.push({
        name: binding.imported,
        entry: binding.specifier,
        line: call.getStartLineNumber(),
        args: call.getArguments(),
      });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** The relative modules whose names appear in a call's arguments. */
function modulesNamed(
  calls: readonly FoundCall[],
  imports: ReadonlyMap<string, RelativeImport>,
): ReadonlySet<string> {
  const { SyntaxKind } = loadTsMorph();
  const specifiers = new Set<string>();
  for (const call of calls) {
    for (const argument of call.args) {
      const names = [argument, ...argument.getDescendantsOfKind(SyntaxKind.Identifier)];
      for (const name of names) {
        const imported = imports.get(name.getText());
        if (imported !== undefined) specifiers.add(imported.specifier);
      }
    }
  }
  return specifiers;
}

/** Read every source file under `root` against the 3.0 rows. */
export async function runV3Readiness(root: string, options: V3Options = {}): Promise<V3Report> {
  const io = options.io ?? { list: collectFiles, read: (path) => readFile(path, 'utf8') };
  const modules = new Map<string, ReadonlyMap<string, OptionFacts>>();
  /** The const literals of the module a specifier names; none when no candidate can be read. */
  const literalsOf = async (
    from: string,
    specifier: string,
  ): Promise<ReadonlyMap<string, OptionFacts>> => {
    for (const path of candidates(from, specifier)) {
      const known = modules.get(path);
      if (known !== undefined) return known;
      let text: string;
      try {
        text = await io.read(path);
      } catch {
        continue;
      }
      // A component file has script blocks, not exports to import by name.
      const [block] = scriptBlocks(text, path);
      const literals =
        block?.start === 0 && block.end === text.length
          ? declaredOptions(parseScript(text, block.kind, 'shared'))
          : new Map<string, OptionFacts>();
      modules.set(path, literals);
      return literals;
    }
    return new Map();
  };

  const places = new Map<string, V3Place[]>();
  const unread: V3Place[] = [];
  let files = 0;
  for (const file of await io.list(root)) {
    const source = await io.read(file);
    if (!importsThisPackage(source)) continue;
    files += 1;
    const name = relative(root, file) || file;
    for (const block of scriptBlocks(source, file)) {
      const script = parseScript(source.slice(block.start, block.end), block.kind);
      const firstLine = lineNumberAt(source, block.start);
      const imports = relativeImports(script);
      const calls = callsIn(script);
      // Reading a module waits; the syntax tree does not, so the modules come first.
      const shared = new Map<string, ReadonlyMap<string, OptionFacts>>();
      for (const specifier of modulesNamed(calls, imports)) {
        shared.set(specifier, await literalsOf(file, specifier));
      }
      for (const call of calls) {
        const place = { file: name, line: call.line + firstLine - 1, call: call.name };
        const verdicts = judgeCall({
          name: call.name,
          entry: call.entry,
          args: call.args.map((argument) =>
            optionFacts(argument, imports, (from) => shared.get(from.specifier)?.get(from.name)),
          ),
        });
        for (const [rule, verdict] of verdicts) {
          if (verdict === 'changes') places.set(rule, [...(places.get(rule) ?? []), place]);
        }
        if ([...verdicts.values()].includes('unread')) unread.push(place);
      }
    }
  }
  return {
    root,
    files,
    rows: V3_RULES.flatMap((rule) => {
      const found = places.get(rule.id);
      return found === undefined ? [] : [{ rule, places: found }];
    }),
    unread,
  };
}

const where = (place: V3Place): string => `${place.file}:${String(place.line)}`;

/** The report as text: a row, its places, what to write there. */
export function formatV3Readiness(report: V3Report): string {
  const lines = [`pll doctor --v3 — what 3.0 changes in ${report.root} (ADR 0007)`, ''];
  for (const { rule, places } of report.rows) {
    lines.push(`Row ${String(rule.row)}: ${rule.title}`);
    for (const place of places) lines.push(`  ${where(place)}`);
    lines.push(`  ${rule.remedy}`, '');
  }
  const count = report.rows.reduce((sum, row) => sum + row.places.length, 0);
  if (count > 0) {
    lines.push(
      `${String(count)} place(s) in ${String(report.rows.length)} row(s); ` +
        `${String(report.files)} file(s) use the package.`,
    );
  } else if (report.unread.length === 0) {
    lines.push(`No call in ${String(report.files)} file(s) that use the package changes with 3.0.`);
  } else {
    lines.push('No call this check could read changes with 3.0.');
  }
  if (report.unread.length > 0) {
    lines.push(
      '',
      `Not read: ${String(report.unread.length)} call(s) take options this check cannot follow ` +
        '(a value from another package, an alias path or a function call). ' +
        'The development notices name them at run time.',
      ...report.unread.map((place) => `  ${where(place)} ${place.call}`),
    );
  }
  return `${lines.join('\n')}\n`;
}
