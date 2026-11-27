/**
 * `payload-live-preview/codegen` — types and the preview inventory from a
 * Payload config (`./generate-types`), and the template annotator. Requires ts-morph.
 */

export {
  generateTypes,
  type GenerateTypesOptions,
  type GenerateTypesResult,
} from './generate-types';
export type {
  AnnotateOptions,
  AnnotateResult,
  AnnotateFileResult,
  AnnotationCandidate,
  AnnotationRefusal,
  AnnotatableSchema,
} from './annotate/index';
export type { PreviewInventory, PreviewInventoryEntry, PreviewInventoryField } from './inventory';
export type { ExtractedSchema, ExtractedSlug, ExtractedField } from './parser/types';
