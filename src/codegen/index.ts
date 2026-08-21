/**
 * Programmatic codegen API.
 *
 *   ```ts
 *   import { generateTypes } from 'payload-live-preview/codegen';
 *   const { code, diagnostics } = await generateTypes({
 *     configPath: 'backend/src/payload.config.ts',
 *     outFile: 'frontend/src/payload-types.ts',
 *   });
 *   ```
 *
 * @module @codegen
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { extractSchema, type ExtractSchemaOptions } from './parser/extract-schema';
import { emitTypes, type EmitOptions } from './emit/emit-types';
import type { ExtractedSchema } from './parser/types';

import { buildPreviewInventory, type PreviewInventory } from './inventory';

export interface GenerateTypesOptions
  extends Pick<ExtractSchemaOptions, 'configPath' | 'project' | 'tsConfigFilePath'>, EmitOptions {
  /**
   * If set, the generated code is written to this absolute or
   * cwd-relative path. The function still returns the rendered string
   * in `code` so callers can verify before writing.
   */
  readonly outFile?: string;
  /** Working directory used to resolve relative paths. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /**
   * If set, the preview inventory is written to this path as JSON.
   *
   * Every field a binding can address, spelled the way the runtime resolves it.
   * Consumers have had to re-derive that spelling to check their markup against
   * the schema, and re-deriving it is where the two drift apart.
   */
  readonly inventoryFile?: string;
}

export interface GenerateTypesResult {
  readonly code: string;
  readonly diagnostics: readonly string[];
  readonly schema: ExtractedSchema;
  readonly outFile?: string;
  /** Always produced; written to disk only when `inventoryFile` is set. */
  readonly inventory: PreviewInventory;
  readonly inventoryFile?: string;
}

export async function generateTypes(options: GenerateTypesOptions): Promise<GenerateTypesResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = isAbsolute(options.configPath)
    ? options.configPath
    : resolve(cwd, options.configPath);
  const schema = extractSchema({
    configPath,
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.tsConfigFilePath !== undefined
      ? { tsConfigFilePath: options.tsConfigFilePath }
      : {}),
  });
  const code = emitTypes(schema, options);
  const inventory = buildPreviewInventory(schema);

  const result: GenerateTypesResult = {
    code,
    diagnostics: schema.diagnostics,
    schema,
    inventory,
    ...(options.outFile !== undefined
      ? { outFile: isAbsolute(options.outFile) ? options.outFile : resolve(cwd, options.outFile) }
      : {}),
    ...(options.inventoryFile !== undefined
      ? {
          inventoryFile: isAbsolute(options.inventoryFile)
            ? options.inventoryFile
            : resolve(cwd, options.inventoryFile),
        }
      : {}),
  };

  if (result.outFile) {
    await mkdir(dirname(result.outFile), { recursive: true });
    await writeFile(result.outFile, code, 'utf8');
  }
  if (result.inventoryFile) {
    await mkdir(dirname(result.inventoryFile), { recursive: true });
    // Trailing newline and stable key order so the file is diffable and can be
    // committed as a contract rather than regenerated noise.
    await writeFile(result.inventoryFile, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  }

  return result;
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
