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
  bindNavigationLifecycle,
  type NavigationLifecycleOptions,
  type NavigationLifecycleTarget,
} from './core/navigation-lifecycle';
export type {
  InspectionBindings,
  InspectionOrigins,
  InspectionProtocol,
  InspectionRevisions,
  InspectionScheduler,
  LivePreviewInspection,
} from './core/inspection/types';
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
  escapeHtml,
  escapeHtmlAttribute,
  type CspDirectiveMerge,
  type FrameAncestorsOptions,
  type SanitizerDocument,
} from './security';

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
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- kept through 1.x (ADR 0007, entry 1)
  isPreviewRequest,
  type PreviewRequestLike,
  type PreviewRequestOptions,
} from './adapters/shared/preview-request';

// Draft-aware initial fetch for preview loaders
export {
  fetchPreviewDocument,
  fetchPreviewGlobal,
  type FetchPreviewDocumentOptions,
  type FetchPreviewGlobalOptions,
  type PreviewFetchBaseOptions,
  type PreviewWhere,
} from './preview-fetch';

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
export type { CachedElement, FieldRenderer, FieldType, RenderContext } from './core/types';

// Protocol negotiation
export {
  LIBRARY_PROTOCOL_VERSION,
  hasCapability,
  negotiateProtocol,
} from './core/protocol-version';
export type { ProtocolCapability, ProtocolNegotiation } from './core/protocol-version';

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
  PreviewBindingsBooleanOptions,
  PreviewBindingsCommonOptions,
  PreviewBindingsContextOptions,
  SuppressedBinding,
  ValueAt,
} from './dsl';

// Payload protocol types
export type {
  PayloadFieldSchema,
  PayloadFieldType,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from './types/payload-protocol';
