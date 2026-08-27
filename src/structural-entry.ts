/**
 * `payload-live-preview/structural` — the keyed list machinery on its own.
 *
 * The structural array renderer patches a bound list item by item and keeps
 * visitor state (focus, typed values, open `<details>`, custom-element
 * internals) through a keyed morph (ADR 0008). A project that renders lists
 * itself — a framework island, a table component — can use the same morph
 * and boundary rules instead of re-implementing them, without pulling the
 * runtime, the Lexical renderer or the built-in plugins into its bundle.
 *
 * @module payload-live-preview/structural
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
