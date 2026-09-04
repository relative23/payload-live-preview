/**
 * `pll migrate`: the 1.x → 2.0 codemods and the driver that applies them to one
 * source string. Rewrites are planned on the AST (ts-morph) so only names the
 * package binds are touched; see ADR 0007.
 */
import { applyTextEdits, parseScript } from './ast';
import { moveFetchPreviewHelpers } from './codemods/move-fetch-preview-helpers';
import { renameBindingsAuthorizedOption } from './codemods/rename-bindings-authorized-option';
import { renameIsPreviewRequest } from './codemods/rename-is-preview-request';
import { scriptBlocks } from './script-blocks';
import type {
  Codemod,
  CodemodConflict,
  CodemodEdit,
  CodemodImplementation,
  CodemodLineEdit,
} from './types';

export type {
  Codemod,
  CodemodConflict,
  CodemodEdit,
  CodemodLineEdit,
  CodemodPlan,
  TextEdit,
} from './types';

const PACKAGE_REFERENCE =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]payload-live-preview(?:\/[^'"]*)?['"]/u;

/** Whether the source names the package in an `import`, `import()` or `require()`. */
export function importsThisPackage(source: string): boolean {
  return PACKAGE_REFERENCE.test(source);
}

const IMPLEMENTATIONS: readonly CodemodImplementation[] = [
  renameIsPreviewRequest,
  renameBindingsAuthorizedOption,
  moveFetchPreviewHelpers,
];

/**
 * The codemods in the order they run. Each is idempotent. Metadata only: the
 * rewrite is internal, so importing this entry's types does not require
 * `ts-morph`, which is needed only to run `pll migrate`.
 */
export const CODEMODS: readonly Codemod[] = IMPLEMENTATIONS;

export interface MigrateSourceOptions {
  /** Restrict to these codemod ids. */
  readonly only?: readonly string[];
  /**
   * Decides how the source is parsed: `.astro`, `.vue` and `.svelte` by script
   * block, JSX by extension. Defaults to a `.ts` module.
   */
  readonly fileName?: string;
}

export interface MigrateSourceResult {
  readonly output: string;
  readonly edits: readonly CodemodEdit[];
  readonly conflicts: readonly CodemodConflict[];
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (source[index] === '\n') line += 1;
  return line;
}

/** The changed lines between two versions, trimmed to the differing middle. */
function lineEdits(before: string, after: string, firstLine: number): CodemodLineEdit[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const changed: CodemodLineEdit[] = [];
  for (let index = 0; index < Math.max(oldMiddle.length, newMiddle.length); index += 1) {
    const before = oldMiddle[index] ?? '';
    const after = newMiddle[index] ?? '';
    if (before !== after) changed.push({ line: firstLine + prefix + index, before, after });
  }
  return changed;
}

/** Apply every codemod (or the chosen subset) to one source string. */
export function migrateSource(
  source: string,
  options: MigrateSourceOptions = {},
): MigrateSourceResult {
  const chosen =
    options.only === undefined
      ? IMPLEMENTATIONS
      : IMPLEMENTATIONS.filter((codemod) => options.only?.includes(codemod.id));
  if (chosen.length === 0 || !importsThisPackage(source)) {
    return { output: source, edits: [], conflicts: [] };
  }
  const byCodemod = new Map<string, CodemodLineEdit[]>();
  const conflicts: CodemodConflict[] = [];
  let output = '';
  let cursor = 0;
  for (const block of scriptBlocks(source, options.fileName ?? 'source.ts')) {
    output += source.slice(cursor, block.start);
    const firstLine = lineNumberAt(source, block.start);
    let text = source.slice(block.start, block.end);
    for (const codemod of chosen) {
      const plan = codemod.apply(parseScript(text, block.kind));
      for (const item of plan.conflicts) {
        conflicts.push(
          item.line === undefined ? item : { ...item, line: item.line + firstLine - 1 },
        );
      }
      if (plan.edits.length === 0) continue;
      const next = applyTextEdits(text, plan.edits);
      const lines = byCodemod.get(codemod.id) ?? [];
      lines.push(...lineEdits(text, next, firstLine));
      byCodemod.set(codemod.id, lines);
      text = next;
    }
    output += text;
    cursor = block.end;
  }
  output += source.slice(cursor);
  const edits = [...byCodemod].map(([codemod, lines]) => ({ codemod, count: lines.length, lines }));
  return { output, edits, conflicts };
}
