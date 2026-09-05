/**
 * `payload-live-preview/server` — the privileged surface: the initial draft
 * read, token issuance and verification, and the gated binding helpers. The
 * architecture policy keeps it out of every browser bundle. A pure barrel: the
 * read lives in ./preview so coverage measures it.
 */

export {
  AUTHORIZED_PREVIEW_BRAND_KEY,
  authorizePreviewRequest,
  extractCookie,
  isAuthorizedPreviewContext,
  issuePreviewToken,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type FetchLike,
  type IssuePreviewTokenOptions,
  type PayloadSessionStrategy,
  type PreviewAuthorization,
  type PreviewAuthorizationOutcome,
  type PreviewAuthorizationRequest,
  type PreviewAuthorizationStrategy,
  type PreviewAuthorizationStrategyName,
  type PreviewTokenClaims,
  type PreviewTokenReplayStore,
  type PreviewTokenTransport,
  type PreviewVerifierClaims,
  type SignedTokenStrategy,
  type SubtleCryptoLike,
  type VerifierStrategy,
} from '@security/preview-authorization';
export {
  hasPreviewIntent,
  type PreviewRequestLike,
  type PreviewRequestOptions,
  type PreviewSignal,
} from '@adapters/shared/preview-request';
export { bind, bindByPath, createPreviewBindings } from '@dsl/index';
export type {
  BindOptions,
  FieldBindingAttributes,
  FieldName,
  FieldPath,
  OwnerBindingAttributes,
  PreviewBindings,
  PreviewBindingsCommonOptions,
  PreviewBindingsOptions,
  SuppressedBinding,
  ValueAt,
} from '@dsl/index';
export {
  definePreview,
  PreviewFetchError,
  type PreviewFetchDiagnostic,
  type PreviewFetchFailureReason,
  type PreviewFetchFunction,
  type PreviewFetchResult,
  type PreviewReadOptions,
  type PreviewRuntimeOptions,
  type PreviewServer,
  type PreviewServerConfig,
  type PreviewWhere,
  type PreviewWhereValue,
  type ReadDocumentOptions,
  type ReadGlobalOptions,
} from './preview';
