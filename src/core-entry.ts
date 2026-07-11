/**
 * Narrow public entry — the minimum API for sites that only need to
 * receive postMessage updates and apply them to the DOM.
 *
 * Consumers who import from `@relative23/payload-live-preview/core`
 * get a bundle that **does not** include:
 *
 *   - the Lexical rich-text renderer (`@lexical/*`)
 *   - the built-in plugins (`@plugins/built-in/*`)
 *   - the inline-script generator and the embedded runtime source
 *   - the framework adapters
 *
 * These pieces add weight without being needed on a typical
 * production page. The full entry (`@relative23/payload-live-preview`)
 * still re-exports everything for users who want the convenience.
 *
 * @packageDocumentation
 */

export { VERSION } from './version';
export const CORE_ENTRY = true;

// High-level client — without the heavyweight built-in plugins.
export { LivePreviewClient, initLivePreview, type LivePreviewClientConfig } from './client';

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

// Events
export {
  EventEmitter,
  type EventHandler,
  type LivePreviewEventMap,
  type Unsubscribe,
} from './events';

// Detection helpers
export {
  OriginDetector,
  detectInitialLocale,
  isInIframe,
  isInPopup,
  isInPreviewContext,
  isDevMode,
} from './detection';

// Protocol negotiation — needed for any consumer that wants to branch
// on capabilities.
export {
  LIBRARY_PROTOCOL_VERSION,
  hasCapability,
  negotiateProtocol,
} from './core/protocol-version';
export type { ProtocolCapability, ProtocolNegotiation } from './core/protocol-version';

// Typed binding DSL — small enough to live in the core slice
export { bind, bindByPath } from './dsl';
export type { BindOptions, FieldBindingAttributes, FieldName, FieldPath, ValueAt } from './dsl';

// Core types
export type { CachedElement, FieldRenderer, FieldType, RenderContext } from './core/types';

// Payload protocol types
export type {
  PayloadFieldSchema,
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';
