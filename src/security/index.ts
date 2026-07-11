/**
 * Public security barrel.
 *
 * Re-exports the curated, dependency-free security primitives. All other
 * modules in this library should import from this entry, never directly
 * from the individual files, so we have one place to enforce policy.
 *
 * @module @security
 */

export { escapeHtml, escapeHtmlAttribute, escapeCssUrl, escapeAndLinebreak } from './escape';
export { isSafeUrl, isExternalHttpUrl, SAFE_URL_PROTOCOLS } from './url-validator';
export {
  sanitizeHtml,
  setSanitizerDocument,
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
