/**
 * URL safety: the one scheme allow-list the runtime, the client and the
 * sanitizer share. Empty strings are not safe (`<a href="">` is never emitted).
 */

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

const RELATIVE_PATH = /^(?:\.{1,2}\/|[a-zA-Z0-9_-]+\/?)/;

// The URL parser treats `\` as `/` for special schemes, so `/\evil.com`
// resolves to another origin rather than to a same-origin path.
const PROTOCOL_RELATIVE = /^[\\/]{2}/;

/** The URL parser drops these anywhere in the input before it looks at anything. */
const PARSER_IGNORED = /[\t\n\r]/g;

/**
 * What is dropped from a value before it is read for a scheme: JavaScript's
 * whitespace and DOMPurify's `ATTR_WHITESPACE` together. That is ASCII
 * controls and spaces, the no-break spaces, the byte-order mark and the Unicode
 * space and format ranges. The URL parser keeps most of these, so `java
 * script:` is a relative path to it; a sanitizer in front of an older parser
 * reads a scheme through the gaps, and the union stays at least as strict as
 * each of the two.
 */
/* eslint-disable no-control-regex -- the class takes in DOMPurify's, which has controls */
const SCHEME_GAPS = /[\s\u0000-\u001f\u180e\u2000-\u2029]/g;
/* eslint-enable no-control-regex */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** Whether `value`, with the gaps closed, starts with a scheme the allow-list does not hold. */
function spellsUnsafeScheme(value: string): boolean {
  const scheme = SCHEME.exec(value.replace(SCHEME_GAPS, ''))?.[1];
  return scheme !== undefined && !SAFE_PROTOCOLS.has(`${scheme.toLowerCase()}:`);
}

/** `true` only for absolute `http`/`https`/`mailto`/`tel` URLs, protocol-relative URLs, paths, `#`/`?` fragments and relative paths. */
export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().replace(PARSER_IGNORED, '');
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) return true;
  if (PROTOCOL_RELATIVE.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return true;
  try {
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return RELATIVE_PATH.test(trimmed) && !spellsUnsafeScheme(trimmed);
  }
}

/** Whether a URL points at another HTTP(S) origin, protocol-relative forms included, and so needs `noopener` hardening; every URL these two patterns match is one `isSafeUrl` admits. */
export function isExternalHttpUrl(url: string): boolean {
  const trimmed = url.trim().replace(PARSER_IGNORED, '');
  return /^https?:\/\//i.test(trimmed) || PROTOCOL_RELATIVE.test(trimmed);
}

/** The safe scheme set, for tests and introspection. */
export const SAFE_URL_PROTOCOLS: ReadonlySet<string> = SAFE_PROTOCOLS;
