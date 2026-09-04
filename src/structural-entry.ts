/**
 * `payload-live-preview/structural`: the keyed morph and the structural array
 * renderer on their own (ADR 0008), for a project that renders lists itself
 * and wants the same boundary rules without the runtime or Lexical.
 */

export { createStructuralArrayRenderer } from './field-types/structural-array';
export {
  KEY_ATTRIBUTE,
  applyStructuralPatches,
  createStructuralStore,
  type StructuralApplyOptions,
  type StructuralStore,
} from './core/structural-applier';
export {
  ISLAND_ATTRIBUTE,
  OWNED_ATTRIBUTE,
  isMorphBoundary,
  isMorphCompatible,
  morphElement,
  type MorphOptions,
} from './core/morph';
export {
  dependencyMapFromBinding,
  mergeDependencyMaps,
  parseDependencyList,
  type DependencyMap,
} from './core/dependencies';
export type {
  CachedElement,
  CustomRendererKey,
  FieldRenderer,
  FieldType,
  RenderContext,
  RendererKey,
  RichTextRenderer,
} from './core/types';
export type {
  PayloadBlockSchema,
  PayloadFieldCondition,
  PayloadFieldSchema,
  PayloadFieldType,
  PayloadLivePreviewData,
} from './types/payload-protocol';
export type { ArrayPatch } from './schema/diff';
// `CachedElement.strategyKind` is typed with it, so this entry must name it too.
export type { UpdateSource } from './core/strategies';
