/**
 * `pll-codegen annotate`: put `data-payload-field` where a template already
 * prints a field, and report every place it would have had to guess.
 *
 * The schema decides what exists — the same inventory `--inventory` writes, so
 * an annotation and a runtime binding spell a path the same way. What the tool
 * cannot attribute is listed, never invented: an unbound field costs an editor
 * one invisible edit, a wrongly bound one writes a value into the wrong element
 * on every keystroke.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { PreviewInventory } from '../inventory';
import {
  applyAnnotations,
  scanTemplate,
  type AnnotationCandidate,
  type AnnotationRefusal,
} from './scan';

export type { AnnotationCandidate, AnnotationRefusal } from './scan';

/** Templates this scanner understands; a `.vue` template uses `{{ … }}` and is not one yet. */
export const ANNOTATABLE_EXTENSIONS: readonly string[] = ['.astro', '.jsx', '.tsx', '.svelte'];

export interface AnnotateFileResult {
  readonly file: string;
  /** The annotated source; identical to the input when nothing was added. */
  readonly code: string;
  readonly annotations: readonly AnnotationCandidate[];
  readonly refusals: readonly AnnotationRefusal[];
  readonly changed: boolean;
}

export interface AnnotateResult {
  readonly files: readonly AnnotateFileResult[];
  readonly annotationCount: number;
  readonly refusalCount: number;
  /** Whether the files were written; `false` is a dry run. */
  readonly written: boolean;
}

export interface AnnotateOptions {
  /** Template files to read. */
  readonly files: readonly string[];
  /** The schema's addressable paths, from `generateTypes().inventory`. */
  readonly inventory: PreviewInventory;
  /** Write the annotated sources back. Without it nothing is touched. */
  readonly write?: boolean;
  /** Resolves the paths in the report. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Reader/writer injection for tests. */
  readonly io?: {
    readonly read: (path: string) => Promise<string>;
    readonly write: (path: string, content: string) => Promise<void>;
  };
}

/**
 * Every path the schema can address, in one set.
 *
 * An array's items are spelled `slides.*.caption` in the inventory because that
 * is how the runtime resolves them; a template writes `slide.caption` inside a
 * loop, where nothing connects `slide` to `slides`. Those paths are therefore
 * kept out: the scanner would otherwise match a name that only looks right.
 */
export function annotatablePaths(inventory: PreviewInventory): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const entry of [...inventory.globals, ...inventory.collections]) {
    for (const field of entry.fields) {
      if (!field.path.includes('*')) paths.add(field.path);
    }
  }
  return paths;
}

export async function annotateTemplates(options: AnnotateOptions): Promise<AnnotateResult> {
  const read = options.io?.read ?? ((path: string) => readFile(path, 'utf8'));
  const write =
    options.io?.write ?? ((path: string, content: string) => writeFile(path, content, 'utf8'));
  const root = options.cwd ?? process.cwd();
  const paths = annotatablePaths(options.inventory);
  const files: AnnotateFileResult[] = [];

  for (const file of options.files) {
    const source = await read(file);
    const { candidates, refusals } = scanTemplate(source, { paths });
    const code = candidates.length === 0 ? source : applyAnnotations(source, candidates);
    const changed = code !== source;
    if (changed && options.write === true) await write(file, code);
    files.push({
      file: relative(root, file) || file,
      code,
      annotations: candidates,
      refusals,
      changed,
    });
  }

  return {
    files,
    annotationCount: files.reduce((total, file) => total + file.annotations.length, 0),
    refusalCount: files.reduce((total, file) => total + file.refusals.length, 0),
    written: options.write === true,
  };
}

/** The report, one line per annotation and per refusal, in file order. */
export function formatAnnotateReport(result: AnnotateResult): string {
  const lines: string[] = [];
  for (const file of result.files) {
    if (file.annotations.length === 0 && file.refusals.length === 0) continue;
    lines.push(file.file);
    for (const annotation of file.annotations) {
      lines.push(`  ${String(annotation.line)}: <${annotation.tag}> → ${annotation.path}`);
    }
    for (const refusal of file.refusals) {
      lines.push(
        `  ${String(refusal.line)}: left alone — ${refusal.reason} (${refusal.expression})`,
      );
    }
  }
  const verb = result.written ? 'annotated' : 'would annotate';
  lines.push(
    `${verb} ${String(result.annotationCount)} element(s); ` +
      `${String(result.refusalCount)} left for a human`,
  );
  return `${lines.join('\n')}\n`;
}
