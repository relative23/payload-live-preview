/**
 * `payload-live-preview/annotate`: the build-time annotator.
 *
 * Its own entry rather than a corner of `payload-live-preview/codegen`, because
 * that one needs `ts-morph` to read a Payload config and this one needs nothing
 * but the scanner. A build plugin that dragged a TypeScript compiler into every
 * project that used it would be a reason not to use it.
 */

export {
  annotateSource,
  livePreviewAnnotate,
  splitFrontmatter,
  type AnnotatePluginOptions,
  type AnnotateVitePlugin,
} from './vite-plugin';
export type { AnnotationCandidate, AnnotationRefusal } from './scan';
export type { AnnotatableSchema } from './index';
