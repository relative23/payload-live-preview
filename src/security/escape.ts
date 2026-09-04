/** HTML and CSS escaping primitives (OWASP XSS Prevention Cheat Sheet). DOM-free. */

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

/** Escape `text` for an element body or a *quoted* attribute value; strings only, and unquoted attributes are not covered. */
export function escapeHtml(text: string): string {
  if (text === '') return '';
  // The character class and the map are coupled: every match is a key.
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
  return text.replace(HTML_ESCAPE_PATTERN, (char) => HTML_ESCAPES[char] as string);
}

/** Escape a value for a CSS `url(...)` literal; this stops the break-out, not the scheme, so pair it with `isSafeUrl()`. */
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

/** Escape a value for a *quoted* HTML attribute, leaving URL characters intact; it validates no scheme, so run `isSafeUrl()` on `href`/`src` first. */
export function escapeHtmlAttribute(value: string): string {
  if (value === '') return '';
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
  return value.replace(ATTR_ESCAPE_PATTERN, (char) => ATTR_ESCAPES[char] as string);
}

/** `escapeHtml()` then newlines to `<br>`; the order is what makes it safe. */
export function escapeAndLinebreak(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}
