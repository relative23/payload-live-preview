/**
 * URL safety validation.
 *
 * Single source of truth for URL-protocol decisions used by both the
 * inline runtime and the high-level client. The previous version of
 * this library had two implementations that subtly disagreed; this
 * module replaces both.
 *
 * Policy:
 *   - Allow only the protocols in `SAFE_PROTOCOLS`.
 *   - Reject every other protocol explicitly, including `javascript:`,
 *     `data:`, `vbscript:`, `file:`, `blob:`, and any custom scheme.
 *   - Empty strings are NOT considered safe (this is a tightening from
 *     the legacy behaviour and avoids producing `<a href="">` markup).
 *
 * @module @security/url-validator
 */

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Matches dangerous-scheme prefixes even with leading whitespace that some
// browsers strip before scheme detection.
const DANGEROUS_PROTOCOL_PATTERN = /^\s*(?:javascript|data|vbscript|file|blob|about)\s*:/i;

const RELATIVE_PATH = /^(?:\.{1,2}\/|[a-zA-Z0-9_-]+\/?)/;

/**
 * Returns `true` only when `url` is one of the explicitly allowed forms:
 *
 *   - Absolute URL with `http:`, `https:`, `mailto:`, or `tel:` protocol
 *   - Protocol-relative URL (`//example.com/...`)
 *   - Same-origin absolute path (`/foo`)
 *   - Hash or query fragment (`#section`, `?q=1`)
 *   - Plain relative path (`foo/bar`, `./foo`, `../foo`)
 */
export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  // Eliminate dangerous schemes before any parsing.
  if (DANGEROUS_PROTOCOL_PATTERN.test(trimmed)) return false;

  // Same-document fragments and query-only URLs are always safe.
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) return true;

  // Protocol-relative URLs inherit the page scheme; treat as safe.
  if (trimmed.startsWith('//')) return true;

  // Same-origin absolute paths are safe.
  if (trimmed.startsWith('/')) return true;

  // Try to parse as a fully qualified URL; fall back to a relative-path
  // heuristic if the input has no scheme at all.
  try {
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return RELATIVE_PATH.test(trimmed);
  }
}

/**
 * Returns `true` when the URL points to an external HTTP(S) origin.
 * Protocol-relative URLs (`//example.com/...`) count as external —
 * they resolve to another origin and need the same `noopener`
 * hardening as absolute ones.
 *
 * Used by renderers to decide whether to add `target="_blank"` and the
 * `noopener noreferrer` rel attributes to anchors. Inputs that fail
 * `isSafeUrl()` always return `false`.
 */
export function isExternalHttpUrl(url: string): boolean {
  if (!isSafeUrl(url)) return false;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) || /^\/\/[^/]/.test(trimmed);
}

/**
 * The set of protocols this library considers safe. Exposed for tests
 * and consumer introspection; do not mutate.
 */
export const SAFE_URL_PROTOCOLS: ReadonlySet<string> = SAFE_PROTOCOLS;
