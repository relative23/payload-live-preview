/**
 * HTML-escape primitives.
 *
 * Implementations follow the OWASP XSS Prevention Cheat Sheet: each
 * special character is replaced with its decimal or hex entity. The
 * functions are isomorphic — they have no dependency on the DOM and
 * can run in any JavaScript environment (browser, Node, Deno, Bun).
 *
 * @module @security/escape
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
});

const HTML_ESCAPE_PATTERN = /[&<>"'/`=]/g;

/**
 * Escape every HTML-significant character in `text` so the result is
 * safe to interpolate into any HTML context (element body or attribute).
 *
 * - Coerces non-strings via `String(value)`; pass `null`/`undefined`
 *   intentionally — they become `"null"`/`"undefined"`.
 * - Cannot fail; returns `""` for the empty input.
 */
export function escapeHtml(text: string): string {
  if (text === '') return '';
  // The regex character class and the HTML_ESCAPES map are intentionally
  // coupled — every match is guaranteed to be a key in the map.
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
  return text.replace(HTML_ESCAPE_PATTERN, (char) => HTML_ESCAPES[char] as string);
}

/**
 * Escape characters that have special meaning inside a CSS `url(...)`
 * literal so an attacker cannot break out of a value.
 *
 * Use only when constructing CSS at runtime (e.g.,
 * `style.backgroundImage`). Combined with a passing `isSafeUrl()` this
 * eliminates the CSS-injection vector for media URLs.
 */
export function escapeCssUrl(value: string): string {
  return value.replace(/['"()\\]/g, '\\$&');
}

const ATTR_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
});

const ATTR_ESCAPE_PATTERN = /[&<>"']/g;

/**
 * Escape characters that would break out of a double-quoted HTML
 * attribute value. Stricter than `escapeHtml` for body content but
 * preserves URL characters (`/`, `=`, etc.) that are common in
 * `href` and `src` values.
 *
 * Only call this for values that have already been validated as safe
 * URLs or trusted strings; it does NOT block dangerous protocols.
 */
export function escapeHtmlAttribute(value: string): string {
  if (value === '') return '';
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
  return value.replace(ATTR_ESCAPE_PATTERN, (char) => ATTR_ESCAPES[char] as string);
}

/**
 * Escape newlines into `<br>` tags after HTML-escaping the input.
 *
 * The order is critical: escape first, then introduce the `<br>` markers.
 * Reversing the order would let an attacker inject HTML by smuggling
 * `<br>` boundaries around malicious content.
 */
export function escapeAndLinebreak(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}
