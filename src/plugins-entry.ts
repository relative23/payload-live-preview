/**
 * `payload-live-preview/plugins` — the plugin system on its own.
 *
 * `PluginManager`, the plugin contract and the built-in plugins, for plugin
 * authors and for a page that composes its own client. The types the plugin
 * context mentions are re-exported so the declaration is self-contained.
 *
 * @module payload-live-preview/plugins
 */

export * from './plugins';
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
export type { PluginInspection } from './core/inspection/types';
