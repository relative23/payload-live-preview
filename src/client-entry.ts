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
export { LivePreviewClient, initLivePreview, type LivePreviewClientConfig } from './client';
export {
  createPreviewFocusReporter,
  reportPreviewFocus,
  type FocusReportTarget,
  type PreviewFocusMessage,
} from './client/preview-focus';

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
} from './core/session/navigation-lifecycle';
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
export { markHydrated } from './core/hydration/hydration-manual';
export type { PayloadDocumentEventDetail } from './types/payload-protocol';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from './core/diagnostic-codes';
export type { ConnectionStatus } from './core/session/state';
export type { DefaultsProfile, EventSourcePolicy } from './types/defaults-profile';

// What a renderer needs to write safely
export {
  isSafeUrl,
  isExternalHttpUrl,
  sanitizeHtml,
  setSanitizerPolicy,
  setTrustedTypesPolicy,
  escapeHtml,
  type SanitizeOptions,
  type SanitizerDocument,
} from './security';
export type { SanitizerPolicyMode, TrustedHtmlPolicyLike } from './security';

// Lexical rendering
export {
  isLexicalContent,
  lexicalToHtml,
  lexicalToPlainText,
  registerBlockRenderer,
  type BlockRenderer,
  type BlockRenderContext,
  type LexicalNode,
  type LexicalRenderOptions,
  type LexicalRoot,
} from './lexical';

// Events
export {
  EventEmitter,
  type EventHandler,
  type LivePreviewEventMap,
  type Unsubscribe,
} from './events';

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
} from './plugins';

// Origins
export { OriginDetector, type OriginDetectorOptions } from './detection';

// Field-type registry
export {
  registerBuiltinRenderer,
  type PayloadMedia,
  type PayloadRelationship,
} from './field-types';
export type {
  CachedElement,
  CustomRendererKey,
  FieldRenderer,
  FieldType,
  RenderContext,
  RendererKey,
  RichTextRenderer,
} from './core/types';

// Protocol negotiation
export { negotiateProtocol } from './core/protocol/protocol-version';
export type { ProtocolCapability, ProtocolNegotiation } from './core/protocol/protocol-version';
export { CAPABILITY_DECLARATIONS } from './core/protocol/protocol-version';
export type { CapabilityDeclaration, CapabilitySource } from './core/protocol/protocol-version';
export { CAPABILITY_DOCUMENTATION } from './core/protocol/protocol-capability-docs';
export type { CapabilityDocumentation } from './core/protocol/protocol-capability-docs';
export { detectProtocolProfile } from './core/protocol/protocol-profile';
export type { ProtocolProfile, ProtocolProfileName } from './core/protocol/protocol-profile';

// Payload protocol types
export type {
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';

// Islands, and the keyed morph with its boundary rules (ADR 0008)
export {
  isMorphBoundary,
  retainIslandBoundary,
  type IslandUpdateDetail,
} from './core/bindings/islands';
export { morphElement, type MorphOptions } from './core/bindings/morph';
