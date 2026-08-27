/**
 * `payload-live-preview/client` — the client alone.
 *
 * `LivePreviewClient` and `initLivePreview()` with the built-in renderers,
 * for a page that wires the client itself and wants neither the inline
 * script generator nor the framework adapters in its bundle. The types its
 * configuration and inspection surfaces mention are re-exported so the
 * declaration is self-contained.
 *
 * @module payload-live-preview/client
 */

export { LivePreviewClient, initLivePreview, type LivePreviewClientConfig } from './client';
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
export { EventEmitter } from './events';
export type { EventHandler, LivePreviewEventMap, Unsubscribe } from './events';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from './core/diagnostic-codes';
export type {
  InspectionBindings,
  InspectionOrigins,
  InspectionProtocol,
  InspectionRevisions,
  InspectionScheduler,
  LivePreviewInspection,
  PluginInspection,
  InspectionFragments,
  InspectionRoute,
} from './core/inspection/types';
export type { ConnectionStatus } from './core/state';
export type { DefaultsProfile, EventSourcePolicy } from './core/defaults-profile';
export type {
  FieldTransform,
  LivePreviewPlugin,
  PluginContext,
  PluginDisposer,
  PluginEvents,
} from './plugins/types';
export type { PluginCompatibility } from './plugins/compat';
export type {
  FragmentContext,
  FragmentReport,
  FragmentStrategy,
  RouteContext,
  RouteStrategy,
  StrategyHandlers,
  UpdateSource,
} from './core/strategies';
export type { PayloadDocumentEventDetail } from './types/payload-protocol';
