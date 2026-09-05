/** Security barrel: the one import path other layers use for these primitives. */

export { escapeHtml, escapeHtmlAttribute, escapeCssUrl, escapeAndLinebreak } from './escape';
export { isSafeUrl, isExternalHttpUrl, SAFE_URL_PROTOCOLS } from './url-validator';
export {
  sanitizeHtml,
  sanitizeHtmlWithPolicy,
  setSanitizerDocument,
  setSanitizerPolicy,
  type SanitizerPolicyMode,
  SanitizerEnvironmentError,
  SANITIZER_POLICY,
  type SanitizeOptions,
  type SanitizerDocument,
} from './sanitizer';
export {
  generateCspNonce,
  setCspCrypto,
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  mergeCspHeader,
  type CspDirectiveMerge,
  type FrameAncestorSource,
  type FrameAncestorsOptions,
} from './csp';
export {
  authorizePreviewRequest,
  extractCookie,
  isAuthorizedPreviewContext,
  issuePreviewToken,
  PreviewConfigurationError,
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
} from './preview-authorization';
export {
  setTrustedTypesPolicy,
  trustedHtml,
  TRUSTED_TYPES_POLICY_NAME,
  type TrustedHtmlPolicyLike,
} from './trusted-types';
