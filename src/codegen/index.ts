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
}

export interface GenerateTypesResult {
  readonly code: string;
  readonly diagnostics: readonly string[];
  readonly schema: ExtractedSchema;
  readonly outFile?: string;
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

  const result: GenerateTypesResult = options.outFile
    ? {
        code,
        diagnostics: schema.diagnostics,
        schema,
        outFile: isAbsolute(options.outFile) ? options.outFile : resolve(cwd, options.outFile),
      }
    : { code, diagnostics: schema.diagnostics, schema };

  if (result.outFile) {
    await mkdir(dirname(result.outFile), { recursive: true });
    await writeFile(result.outFile, code, 'utf8');
  }

  return result;
}

export { extractSchema } from './parser/extract-schema';
export { emitTypes } from './emit/emit-types';
export type { ExtractedSchema, ExtractedSlug, ExtractedField } from './parser/types';
