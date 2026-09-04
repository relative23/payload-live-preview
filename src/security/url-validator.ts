/**
 * URL safety: the one scheme allow-list the runtime, the client and the
 * sanitizer share. Empty strings are not safe (`<a href="">` is never emitted).
 */

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Browsers strip leading whitespace before scheme detection.
const DANGEROUS_PROTOCOL_PATTERN = /^\s*(?:javascript|data|vbscript|file|blob|about)\s*:/i;

const RELATIVE_PATH = /^(?:\.{1,2}\/|[a-zA-Z0-9_-]+\/?)/;

// The URL parser treats `\` as `/` for special schemes, so `/\evil.com`
// resolves to another origin rather than to a same-origin path.
const PROTOCOL_RELATIVE = /^[\\/]{2}/;

/** The URL parser drops these anywhere in the input before it looks at anything. */
const PARSER_IGNORED = /[\t\n\r]/g;

/** `true` only for absolute `http`/`https`/`mailto`/`tel` URLs, protocol-relative URLs, paths, `#`/`?` fragments and relative paths. */
export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  const trimmed = url.trim().replace(PARSER_IGNORED, '');
  if (trimmed.length === 0) return false;
  if (DANGEROUS_PROTOCOL_PATTERN.test(trimmed)) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) return true;
  if (PROTOCOL_RELATIVE.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return true;
  try {
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return RELATIVE_PATH.test(trimmed);
  }
}

/** Whether a safe URL points at another HTTP(S) origin, protocol-relative forms included, and so needs `noopener` hardening. */
export function isExternalHttpUrl(url: string): boolean {
  if (!isSafeUrl(url)) return false;
  const trimmed = url.trim().replace(PARSER_IGNORED, '');
  return /^https?:\/\//i.test(trimmed) || PROTOCOL_RELATIVE.test(trimmed);
}

/** The safe scheme set, for tests and introspection. */
export const SAFE_URL_PROTOCOLS: ReadonlySet<string> = SAFE_PROTOCOLS;
