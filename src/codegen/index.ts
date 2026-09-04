/**
 * Programmatic codegen API: `generateTypes({ configPath, outFile })` parses a
 * Payload config and writes the TypeScript types and, optionally, the preview
 * inventory. Requires ts-morph.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { emitTypes, type EmitOptions } from './emit/emit-types';
import { buildPreviewInventory, type PreviewInventory } from './inventory';
import { extractSchema, type ExtractSchemaOptions } from './parser/extract-schema';
import type { ExtractedSchema } from './parser/types';

export interface GenerateTypesOptions
  extends Pick<ExtractSchemaOptions, 'configPath' | 'project' | 'tsConfigFilePath'>, EmitOptions {
  /** Where to write the generated code; `code` is returned either way. */
  readonly outFile?: string;
  /** Resolves relative paths. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Where to write the preview inventory as JSON: every path a binding may address. */
  readonly inventoryFile?: string;
}

export interface GenerateTypesResult {
  readonly code: string;
  /** Extraction diagnostics, plus a note when nothing was written. */
  readonly diagnostics: readonly string[];
  readonly schema: ExtractedSchema;
  /** The types file actually written; absent when writing was refused. */
  readonly outFile?: string;
  /** Always produced; written to disk only when `inventoryFile` is set. */
  readonly inventory: PreviewInventory;
  readonly inventoryFile?: string;
}

async function writeOut(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

/** Parse the config and write the types, never writing an empty schema over a consumer's file. */
export async function generateTypes(options: GenerateTypesOptions): Promise<GenerateTypesResult> {
  const cwd = options.cwd ?? process.cwd();
  const absolute = (path: string): string => (isAbsolute(path) ? path : resolve(cwd, path));
  const schema = extractSchema({
    configPath: absolute(options.configPath),
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.tsConfigFilePath !== undefined
      ? { tsConfigFilePath: options.tsConfigFilePath }
      : {}),
  });
  const code = emitTypes(schema, options);
  const inventory = buildPreviewInventory(schema);
  const diagnostics = [...schema.diagnostics];
  const outFile = options.outFile === undefined ? undefined : absolute(options.outFile);
  const inventoryFile =
    options.inventoryFile === undefined ? undefined : absolute(options.inventoryFile);
  const targets = [outFile, inventoryFile].filter((path): path is string => path !== undefined);
  const empty = schema.globals.length + schema.collections.length === 0;
  if (empty && targets.length > 0) {
    diagnostics.push(
      `Nothing written: the schema is empty (0 globals, 0 collections), so ${targets.join(' and ')} ` +
        'were left as they are.',
    );
  } else {
    if (outFile !== undefined) await writeOut(outFile, code);
    // Stable key order and a trailing newline keep the inventory diffable.
    if (inventoryFile !== undefined) {
      await writeOut(inventoryFile, `${JSON.stringify(inventory, null, 2)}\n`);
    }
  }
  return {
    code,
    diagnostics,
    schema,
    inventory,
    ...(!empty && outFile !== undefined ? { outFile } : {}),
    ...(!empty && inventoryFile !== undefined ? { inventoryFile } : {}),
  };
}

export { buildPreviewInventory, checkPreviewBindings } from './inventory';
export type {
  PreviewBindingReference,
  PreviewCoverageOptions,
  PreviewInventory,
  PreviewInventoryEntry,
  PreviewInventoryField,
} from './inventory';
export { extractSchema } from './parser/extract-schema';
export { emitTypes } from './emit/emit-types';
export type { ExtractedSchema, ExtractedSlug, ExtractedField } from './parser/types';
