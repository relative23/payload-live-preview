/**
 * Narrow public entry — the minimum API for sites that only need to
 * receive postMessage updates and apply them to the DOM.
 *
 * Consumers who import from `payload-live-preview/core`
 * get a bundle that **does not** include:
 *
 *   - the built-in plugin constructors (`@plugins/built-in/*`)
 *   - the inline-script generator and the embedded runtime source
 *   - the framework adapters
 *
 * The client still includes its built-in field renderers, including Lexical
 * rendering. The omitted exports add weight without being needed on a typical
 * production page. The full entry (`payload-live-preview`) re-exports them for
 * users who want the convenience.
 *
 * @packageDocumentation
 */

import { LivePreviewClient as CoreLivePreviewClient } from './client';
import { EventEmitter as CoreEventEmitter } from './events';
import { OriginDetector as CoreOriginDetector } from './detection';

// The dedicated core build mangles internal names aggressively but preserves
// the long-established `.name` values of its three public classes. Keeping the
// assignments at this entry boundary avoids retaining hundreds of private
// helper names in every consumer bundle.
for (const [constructor, name] of [
  [CoreEventEmitter, 'EventEmitter'],
  [CoreLivePreviewClient, 'LivePreviewClient'],
  [CoreOriginDetector, 'OriginDetector'],
] as const) {
  Object.defineProperty(constructor, 'name', { configurable: true, value: name });
}

export { VERSION } from './version';
export const CORE_ENTRY = true;

// High-level client — without the heavyweight built-in plugins.
export { CoreLivePreviewClient as LivePreviewClient };
export { initLivePreview, type LivePreviewClientConfig } from './client';

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
export { CoreEventEmitter as EventEmitter };
export { type EventHandler, type LivePreviewEventMap, type Unsubscribe } from './events';

// Detection helpers
export { CoreOriginDetector as OriginDetector };
export {
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
export type {
  InspectionBindings,
  InspectionOrigins,
  InspectionProtocol,
  InspectionRevisions,
  PluginInspection,
  InspectionScheduler,
  LivePreviewInspection,
} from './core/inspection/types';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from './core/diagnostic-codes';
export type { ConnectionStatus } from './core/state';

// Typed binding DSL — small enough to live in the core slice
export { bind, bindByPath, createPreviewBindings } from './dsl';
export type { DefaultsProfile, EventSourcePolicy } from './core/defaults-profile';
// The branded verdict `createPreviewBindings({ authorization })` accepts. The
// producer (`authorizePreviewRequest`) lives on the root entry; the guard is a
// few lines and belongs wherever the type is accepted.
export {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type PreviewAuthorizationStrategyName,
} from './types/authorized-preview';
export type {
  BindOptions,
  FieldBindingAttributes,
  FieldName,
  FieldPath,
  OwnerBindingAttributes,
  PreviewBindings,
  PreviewBindingsOptions,
  PreviewBindingsBooleanOptions,
  PreviewBindingsCommonOptions,
  PreviewBindingsContextOptions,
  SuppressedBinding,
  ValueAt,
} from './dsl';

// Core types
export type {
  CachedElement,
  CustomRendererKey,
  FieldRenderer,
  FieldType,
  RenderContext,
  RendererKey,
  RichTextRenderer,
} from './core/types';

// Payload protocol types
export type {
  PayloadFieldSchema,
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';
export type { PluginCompatibility } from './plugins';
export type { SanitizerPolicyMode } from './security';
