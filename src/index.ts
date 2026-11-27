/**
 * payload-live-preview — the root entry. Every value exported here is public
 * API. The package's own modules and tests import what else they need from the
 * module that defines it (ADR 0007, row 15).
 *
 * @packageDocumentation
 */

export { VERSION } from './version';

// High-level client
export { LivePreviewClient, initLivePreview, type LivePreviewClientConfig } from './client';
export {
  createPreviewFocusReporter,
  reportPreviewFocus,
  type FocusReportTarget,
  type PreviewFocusMessage,
} from './client/preview-focus';

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

// Inline-script generator
export {
  generateInlineScript,
  wrapWithScriptTag,
  type InlineScriptConfig,
} from './inline/generator';

// Security primitives (consumers building their own CSP)
export {
  buildFrameAncestors,
  generateCspNonce,
  mergeCspHeader,
  isSafeUrl,
  isExternalHttpUrl,
  sanitizeHtml,
  setSanitizerPolicy,
  setTrustedTypesPolicy,
  escapeHtml,
  type CspDirectiveMerge,
  type FrameAncestorsOptions,
  type SanitizerDocument,
} from './security';
export type { SanitizerPolicyMode, TrustedHtmlPolicyLike } from './security';

// Authorized preview context (ADR 0006)
export {
  authorizePreviewRequest,
  isAuthorizedPreviewContext,
  issuePreviewToken,
} from './security/preview-authorization';
export type {
  AuthorizedPreviewContext,
  AuthorizedPreviewScope,
  AuthorizedPreviewDocument,
  AuthorizedPreviewPayloadScope,
  FetchLike,
  IssuePreviewTokenOptions,
  PayloadSessionStrategy,
  PreviewAuthorization,
  PreviewAuthorizationOutcome,
  PreviewAuthorizationRequest,
  PreviewAuthorizationStrategy,
  PreviewAuthorizationStrategyName,
  PreviewTokenClaims,
  PreviewTokenReplayStore,
  PreviewTokenTransport,
  PreviewVerifierClaims,
  SignedTokenStrategy,
  SubtleCryptoLike,
  VerifierStrategy,
} from './security/preview-authorization';
export type { DefaultsProfile, EventSourcePolicy } from './types/defaults-profile';

// Server-side preview-request detection — for hand-rolled middleware
export {
  hasPreviewIntent,
  type PreviewRequestLike,
  type PreviewRequestOptions,
} from './adapters/shared/preview-request';

// Lexical rendering — useful for SSR pre-rendering of rich text fields
export {
  isLexicalContent,
  lexicalToHtml,
  lexicalToPlainText,
  registerBlockRenderer,
  type BlockRenderer,
  type BlockRenderContext,
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
  documentSavePlugin,
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
} from './plugins';

// Detection helpers (useful for framework adapters)
export { OriginDetector } from './detection';

// Field-type registry (advanced customisation)
export {
  registerBuiltinRenderer,
  type PayloadMedia,
  type PayloadRelationship,
} from './field-types';

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

// Protocol negotiation
export { negotiateProtocol } from './core/protocol/protocol-version';
export type { ProtocolCapability, ProtocolNegotiation } from './core/protocol/protocol-version';
export { CAPABILITY_DECLARATIONS } from './core/protocol/protocol-version';
export type { CapabilityDeclaration, CapabilitySource } from './core/protocol/protocol-version';
export { CAPABILITY_DOCUMENTATION } from './core/protocol/protocol-capability-docs';
export type { CapabilityDocumentation } from './core/protocol/protocol-capability-docs';
export { detectProtocolProfile } from './core/protocol/protocol-profile';
export type { ProtocolProfile, ProtocolProfileName } from './core/protocol/protocol-profile';

// Typed binding DSL — pair with codegen-emitted schema interfaces
export { bind, bindByPath, createPreviewBindings } from './dsl';
export { previewBindingsFromLocals } from './adapters/shared/locals';
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

// Payload protocol types
export type {
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';

// Island interoperability (docs/renderers.md)
export type { IslandUpdateDetail } from './core/bindings/islands';
