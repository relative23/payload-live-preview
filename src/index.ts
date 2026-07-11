/**
 * @relative23/payload-live-preview
 *
 * State-of-the-art, framework-agnostic, schema-driven live preview for Payload CMS.
 *
 * Public entry — re-exports the stable surface.
 *
 * @packageDocumentation
 */

export { VERSION } from './version';

// High-level client
export { LivePreviewClient, initLivePreview, type LivePreviewClientConfig } from './client';

// Inline-script generator
export {
  generateInlineScript,
  wrapWithScriptTag,
  runtimeBuildInfo,
  type InlineScriptConfig,
} from './inline/generator';

// Security primitives (consumers building their own CSP)
export {
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  generateCspNonce,
  setCspCrypto,
  isSafeUrl,
  isExternalHttpUrl,
  sanitizeHtml,
  setSanitizerDocument,
  escapeHtml,
  escapeHtmlAttribute,
  type FrameAncestorsOptions,
  type SanitizerDocument,
} from './security';

// Lexical rendering — useful for SSR pre-rendering of rich text fields
export {
  isLexicalContent,
  lexicalToHtml,
  lexicalToPlainText,
  type LexicalNode,
  type LexicalRoot,
} from './lexical';

// Events
export {
  EventEmitter,
  type EventHandler,
  type LivePreviewEventMap,
  type Unsubscribe,
} from './events';

// Plugins
export {
  highlightPlugin,
  debugPlugin,
  createAnalyticsPlugin,
  type LivePreviewPlugin,
  type PluginContext,
  type FieldTransform,
  type AnalyticsSnapshot,
} from './plugins';

// Detection helpers (useful for framework adapters)
export {
  OriginDetector,
  detectInitialLocale,
  isInIframe,
  isInPopup,
  isInPreviewContext,
  isDevMode,
} from './detection';

// Field-type registry (advanced customisation)
export {
  buildBuiltinRenderers,
  registerBuiltinRenderer,
  type PayloadMedia,
  type PayloadRelationship,
} from './field-types';

// Core types
export type { CachedElement, FieldRenderer, FieldType, RenderContext } from './core/types';

// Protocol negotiation
export {
  LIBRARY_PROTOCOL_VERSION,
  hasCapability,
  negotiateProtocol,
} from './core/protocol-version';
export type {
  ProtocolCapability,
  ProtocolNegotiation,
} from './core/protocol-version';

// Typed binding DSL — pair with codegen-emitted schema interfaces
export { bind, bindByPath } from './dsl';
export type {
  BindOptions,
  FieldBindingAttributes,
  FieldName,
  FieldPath,
  ValueAt,
} from './dsl';

// Payload protocol types
export type {
  PayloadFieldSchema,
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';
