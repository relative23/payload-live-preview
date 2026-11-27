/**
 * `payload-live-preview/structural`: the keyed morph and the structural array
 * renderer on their own (ADR 0008), for a project that renders lists itself
 * and wants the same boundary rules without the runtime or Lexical.
 */

export type { StructuralApplyOptions, StructuralStore } from './core/bindings/structural-applier';
export { isMorphBoundary, retainIslandBoundary } from './core/bindings/islands';
export { morphElement, type MorphOptions } from './core/bindings/morph';
export type { DependencyMap } from './core/update/dependencies';
export type {
  CachedElement,
  CustomRendererKey,
  FieldRenderer,
  FieldType,
  RenderContext,
  RendererKey,
  RichTextRenderer,
} from './core/types';
export type { PayloadFieldType, PayloadLivePreviewData } from './types/payload-protocol';
export type { ArrayPatch } from './schema/diff';
// `CachedElement.strategyKind` is typed with it, so this entry must name it too.
export type { UpdateSource } from './core/strategies/strategies';
// `RenderContext.sanitizerPolicy` names it, so the entry has to as well.
export type { SanitizerPolicyMode } from './security';
