/**
 * Placing the runtime's script tag inside an HTML document, by text: the
 * adapters see a rendered string or a streamed chunk, never a DOM.
 */

/** The opening `<head>` tag the runtime script is inserted into. */
export const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/** `text/html` with or without parameters. */
export const HTML_CONTENT_TYPE = /text\/html/i;

// Browsers prescan only the first 1024 bytes for the encoding; a script
// inserted ahead of `<meta charset>` would push it out of that window.
const META_CHARSET =
  /<meta\s+(?:[^>]*\s)?(?:charset\s*=|http-equiv\s*=\s*["']?content-type)[^>]*>/i;

/**
 * `html` with the script tag after `<meta charset>`, else right after
 * `<head>`; `undefined` when there is no `<head>` to insert into.
 */
export function injectIntoHead(html: string, scriptTag: string): string | undefined {
  const head = HEAD_INSERT.exec(html);
  if (head === null) return undefined;
  const headEnd = head.index + head[0].length;
  const headClose = html.indexOf('</head', headEnd);
  const meta = META_CHARSET.exec(html.slice(headEnd, headClose === -1 ? undefined : headClose));
  const at = meta === null ? headEnd : headEnd + meta.index + meta[0].length;
  return `${html.slice(0, at)}${scriptTag}${html.slice(at)}`;
}
