/** `pll-codegen annotate` as an API: the annotator, its report and the schema shape it reads. */

export {
  ANNOTATABLE_EXTENSIONS,
  annotatableEntities,
  annotatablePaths,
  annotateTemplates,
  formatAnnotateReport,
  type AnnotatableSchema,
  type AnnotateFileResult,
  type AnnotateOptions,
  type AnnotateResult,
} from './annotate-templates';
export type { AnnotationCandidate, AnnotationRefusal } from './scan';
