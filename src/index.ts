/**
 * payload-live-preview
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
} from './core/navigation-lifecycle';
export type {
  InspectionBindings,
  InspectionOrigins,
  InspectionProtocol,
  InspectionRevisions,
  PluginInspection,
  InspectionFragments,
  InspectionRoute,
  InspectionScheduler,
  LivePreviewInspection,
} from './core/inspection/types';
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
export { DIAGNOSTIC_CODES, type DiagnosticCode } from './core/diagnostic-codes';
export type { ConnectionStatus } from './core/state';

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
  mergeCspHeader,
  setCspCrypto,
  isSafeUrl,
  isExternalHttpUrl,
  sanitizeHtml,
  setSanitizerDocument,
  setSanitizerPolicy,
  setTrustedTypesPolicy,
  trustedHtml,
  TRUSTED_TYPES_POLICY_NAME,
  escapeHtml,
  escapeHtmlAttribute,
  type CspDirectiveMerge,
  type FrameAncestorsOptions,
  type SanitizerDocument,
} from './security';
export type { SanitizerPolicyMode, TrustedHtmlPolicyLike } from './security';

// Authorized preview context — the one verdict privileged preview decisions
// are keyed on. See docs/architecture/0006-authorized-preview-context.md.
export {
  authorizePreviewRequest,
  isAuthorizedPreviewContext,
  issuePreviewToken,
} from './security/preview-authorization';
export type {
  AuthorizedPreviewContext,
  AuthorizedPreviewScope,
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
export type { DefaultsProfile, EventSourcePolicy } from './core/defaults-profile';

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
export {
  LIBRARY_PROTOCOL_VERSION,
  hasCapability,
  negotiateProtocol,
} from './core/protocol-version';
export type { ProtocolCapability, ProtocolNegotiation } from './core/protocol-version';
export { CAPABILITY_DECLARATIONS, PROTOCOL_CAPABILITIES } from './core/protocol-version';
export type { CapabilityDeclaration, CapabilitySource } from './core/protocol-version';
export { CAPABILITY_DOCUMENTATION } from './core/protocol-capability-docs';
export type { CapabilityDocumentation } from './core/protocol-capability-docs';
export { detectProtocolProfile } from './core/protocol-profile';
export type { ProtocolProfile, ProtocolProfileName } from './core/protocol-profile';

// Typed binding DSL — pair with codegen-emitted schema interfaces
export { bind, bindByPath, createPreviewBindings } from './dsl';
export type {
  BindOptions,
  FieldBindingAttributes,
  FieldName,
  FieldPath,
  OwnerBindingAttributes,
  PreviewBindings,
  PreviewBindingsOptions,
  PreviewBindingsCommonOptions,
  SuppressedBinding,
  ValueAt,
} from './dsl';

// Payload protocol types
export type {
  PayloadFieldCondition,
  PayloadFieldSchema,
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';

// Island interoperability — the bridge event and the boundary test (docs/renderers.md, islands).
export { ISLAND_EVENT, isInsideIsland, type IslandUpdateDetail } from './core/islands';
