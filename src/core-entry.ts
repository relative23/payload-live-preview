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

export { VERSION } from './version';

// High-level client — without the heavyweight built-in plugins.
export { LivePreviewClient } from './client';
export { initLivePreview, type LivePreviewClientConfig } from './client';

// Security primitives (consumers building their own CSP)
export {
  buildFrameAncestors,
  generateCspNonce,
  isSafeUrl,
  isExternalHttpUrl,
  sanitizeHtml,
  escapeHtml,
  type FrameAncestorsOptions,
  type SanitizerDocument,
} from './security';

// Events
export { EventEmitter } from './events';
export { type EventHandler, type LivePreviewEventMap, type Unsubscribe } from './events';

// Detection helpers
export { OriginDetector } from './detection';

// Protocol negotiation — needed for any consumer that wants to branch
// on capabilities.
export { negotiateProtocol } from './core/protocol/protocol-version';
export type { ProtocolCapability, ProtocolNegotiation } from './core/protocol/protocol-version';
export { CAPABILITY_DECLARATIONS } from './core/protocol/protocol-version';
export type { CapabilityDeclaration, CapabilitySource } from './core/protocol/protocol-version';
export { CAPABILITY_DOCUMENTATION } from './core/protocol/protocol-capability-docs';
export type { CapabilityDocumentation } from './core/protocol/protocol-capability-docs';
export { detectProtocolProfile } from './core/protocol/protocol-profile';
export type { ProtocolProfile, ProtocolProfileName } from './core/protocol/protocol-profile';
export type {
  InspectionBindings,
  InspectionOrigins,
  InspectionProtocol,
  InspectionRevisions,
  PluginInspection,
  InspectionFidelity,
  InspectionFragments,
  InspectionRoute,
  InspectionScheduler,
  LivePreviewInspection,
} from './core/inspection/types';
export type {
  RevisionDisplay,
  RevisionDisplayState,
  RevisionShortfall,
} from './core/update/revision-display';
export type {
  FragmentContext,
  FragmentReport,
  FragmentStrategy,
  RouteContext,
  RouteOutcome,
  RoutePlanContext,
  RouteStrategy,
  StrategyHandlers,
  UpdateSource,
} from './core/strategies/strategies';
export { registerRouteRefresh, type RouteRefresh } from './core/strategies/route-refresh';
export type { PayloadDocumentEventDetail } from './types/payload-protocol';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from './core/diagnostic-codes';
export type { ConnectionStatus } from './core/session/state';

// Typed binding DSL — small enough to live in the core slice
export { bind, bindByPath, createPreviewBindings } from './dsl';
export type { DefaultsProfile, EventSourcePolicy } from './types/defaults-profile';
// The branded verdict `createPreviewBindings({ authorization })` accepts. The
// producer (`authorizePreviewRequest`) lives on the root entry; the guard is a
// few lines and belongs wherever the type is accepted.
export {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type AuthorizedPreviewDocument,
  type AuthorizedPreviewPayloadScope,
  type PreviewAuthorizationStrategyName,
} from './types/authorized-preview';
export type {
  BindOptions,
  FieldBindingAttributes,
  FieldName,
  FieldPath,
  FragmentBoundaryAttributes,
  FragmentBoundaryOptions,
  OwnerBindingAttributes,
  PreviewBindings,
  PreviewBindingsOptions,
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
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';
export type { PluginCompatibility } from './plugins';
export type { SanitizerPolicyMode } from './security';

// Island interoperability: what the bridge event carries (docs/renderers.md, islands).
export type { IslandUpdateDetail } from './core/bindings/islands';

// The framework-free session behind the React and Vue hooks, for a store of your own.
export {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionOptions,
  type DocumentSnapshot,
  type DocumentStatus,
  type PreviewDocument,
} from '@adapters/shared/document-session';
