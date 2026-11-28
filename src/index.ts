/**
 * payload-live-preview — the root entry: everything `payload-live-preview/client`
 * exports, and what a server needs beside it. Every value exported here is
 * public API. The package's own modules and tests import what else they need
 * from the module that defines it (ADR 0007, rows 15 and 46).
 *
 * @packageDocumentation
 */

// What runs in a browser: one list, in the entry a page loads whole.
export * from './client-entry';

// Inline-script generator
export {
  generateInlineScript,
  wrapWithScriptTag,
  type InlineScriptConfig,
} from './runtime/inline/generator';

// CSP helpers for the response that carries the script
export {
  buildFrameAncestors,
  generateCspNonce,
  mergeCspHeader,
  type CspDirectiveMerge,
  type FrameAncestorsOptions,
} from './runtime/security';

// Authorized preview context (ADR 0006)
export {
  authorizePreviewRequest,
  isAuthorizedPreviewContext,
  issuePreviewToken,
} from './runtime/security/preview-authorization';
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
} from './runtime/security/preview-authorization';

// Server-side preview-request detection — for hand-rolled middleware
export {
  hasPreviewIntent,
  type PreviewRequestLike,
  type PreviewRequestOptions,
  type PreviewSignal,
} from './adapters/shared/preview-request';

// Typed binding DSL — pair with codegen-emitted schema interfaces
export { bind, bindByPath, createPreviewBindings } from './runtime/dsl';
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
} from './runtime/dsl';
