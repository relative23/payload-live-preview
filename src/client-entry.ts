/**
 * `payload-live-preview/client`: what runs in a browser, in one entry. The
 * client with its built-in renderers, the framework-free document session, the
 * plugin manager and the built-in plugins, the protocol and origin helpers, the
 * sanitizer and the keyed morph. The root entry is this one and, beside it, what
 * a server needs: the script generator, which holds the runtime as text, and the
 * authorization, CSP and binding helpers. A page that loads an entry without a
 * bundler loads it whole, which is why this one exists (ADR 0007, row 46).
 *
 * @packageDocumentation
 */

export { VERSION } from './version';

// The client
export { LivePreviewClient, initLivePreview, type LivePreviewClientConfig } from './runtime/client';
export {
  createPreviewFocusReporter,
  reportPreviewFocus,
  type FocusReportTarget,
  type PreviewFocusMessage,
} from './runtime/client/preview-focus';

// The framework-free session behind the React and Vue hooks, for a store of your own.
export {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionOptions,
  type DocumentSnapshot,
  type DocumentStatus,
  type PreviewDocument,
} from '@adapters/shared/document-session';

export {
  bindNavigationLifecycle,
  type NavigationLifecycleOptions,
  type NavigationLifecycleTarget,
} from './runtime/core/session/navigation-lifecycle';
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
} from './runtime/core/inspection/types';
export type {
  RevisionDisplay,
  RevisionDisplayState,
  RevisionShortfall,
} from './runtime/core/update/revision-display';
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
} from './runtime/core/strategies/strategies';
export { registerRouteRefresh, type RouteRefresh } from './runtime/core/strategies/route-refresh';
export { markHydrated } from './runtime/core/hydration/hydration-manual';
export type { PayloadDocumentEventDetail } from './runtime/types/payload-protocol';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from './runtime/core/diagnostic-codes';
export type { ConnectionStatus } from './runtime/core/session/state';
export type { DefaultsProfile, EventSourcePolicy } from './runtime/types/defaults-profile';

// What a renderer needs to write safely. Each from its own module, and the Lexical names below
// too: through a barrel this entry would load every chunk the barrel names, the server's
// authorization and CSP helpers among them.
export { isSafeUrl, isExternalHttpUrl } from './runtime/security/url-validator';
export {
  sanitizeHtml,
  setSanitizerPolicy,
  type SanitizeOptions,
  type SanitizerDocument,
  type SanitizerPolicyMode,
} from './runtime/security/sanitizer';
export {
  setTrustedTypesPolicy,
  type TrustedHtmlPolicyLike,
} from './runtime/security/trusted-types';
export { escapeHtml } from './runtime/security/escape';

// Lexical rendering
export {
  isLexicalContent,
  lexicalToHtml,
  lexicalToPlainText,
  type LexicalRenderOptions,
} from './runtime/lexical/render';
export {
  registerBlockRenderer,
  type BlockRenderer,
  type BlockRenderContext,
} from './runtime/lexical/blocks/registry';
export type { LexicalNode, LexicalRoot } from './runtime/lexical/types';

// Events
export {
  EventEmitter,
  type EventHandler,
  type LivePreviewEventMap,
  type Unsubscribe,
} from './runtime/events';

// Plugins: the manager, the contract and the built-in ones
export {
  PluginManager,
  highlightPlugin,
  debugPlugin,
  createAnalyticsPlugin,
  documentSavePlugin,
  createUnboundFieldsOverlayPlugin,
  type PluginManagerOptions,
  type DocumentSaveHandler,
  type DocumentSavePluginOptions,
  type DocumentSaveStrategy,
  type LivePreviewPlugin,
  type PluginCompatibility,
  type PluginContext,
  type PluginEvents,
  type PluginDisposer,
  type FieldTransform,
  type AnalyticsSnapshot,
  type UnboundFieldsOverlayOptions,
} from './runtime/plugins';

// Origins
export { OriginDetector, type OriginDetectorOptions } from './runtime/detection';

// Field-type registry
export {
  registerBuiltinRenderer,
  type PayloadMedia,
  type PayloadRelationship,
} from './runtime/field-types';
export type {
  CachedElement,
  CustomRendererKey,
  FieldRenderer,
  FieldType,
  RenderContext,
  RendererKey,
  RichTextRenderer,
} from './runtime/core/types';

// Protocol negotiation
export { negotiateProtocol } from './runtime/core/protocol/protocol-version';
export type {
  ProtocolCapability,
  ProtocolNegotiation,
} from './runtime/core/protocol/protocol-version';
export { CAPABILITY_DECLARATIONS } from './runtime/core/protocol/protocol-version';
export type {
  CapabilityDeclaration,
  CapabilitySource,
} from './runtime/core/protocol/protocol-version';
export { CAPABILITY_DOCUMENTATION } from './runtime/core/protocol/protocol-capability-docs';
export type { CapabilityDocumentation } from './runtime/core/protocol/protocol-capability-docs';
export { detectProtocolProfile } from './runtime/core/protocol/protocol-profile';
export type {
  ProtocolProfile,
  ProtocolProfileName,
} from './runtime/core/protocol/protocol-profile';

// Payload protocol types
export type {
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './runtime/types/payload-protocol';

// Islands, and the keyed morph with its boundary rules (ADR 0008)
export {
  isMorphBoundary,
  retainIslandBoundary,
  type IslandUpdateDetail,
} from './runtime/core/bindings/islands';
export { morphElement, type MorphOptions } from './runtime/core/bindings/morph';
