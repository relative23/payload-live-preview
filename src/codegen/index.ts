/**
 * `payload-live-preview/codegen` — types and the preview inventory from a
 * Payload config (`./generate-types`), and the template annotator. Requires ts-morph.
 */

export {
  generateTypes,
  type GenerateTypesOptions,
  type GenerateTypesResult,
} from './generate-types';
export {
  annotateTemplates,
  annotatablePaths,
  formatAnnotateReport,
  ANNOTATABLE_EXTENSIONS,
  type AnnotateOptions,
  type AnnotateResult,
  type AnnotateFileResult,
  type AnnotationCandidate,
  type AnnotationRefusal,
  type AnnotatableSchema,
} from './annotate/index';
export { buildPreviewInventory } from './inventory';
export type { PreviewInventory, PreviewInventoryEntry, PreviewInventoryField } from './inventory';
export { extractSchema } from './parser/extract-schema';
export { emitTypes } from './emit/emit-types';
export type { ExtractedSchema, ExtractedSlug, ExtractedField } from './parser/types';
