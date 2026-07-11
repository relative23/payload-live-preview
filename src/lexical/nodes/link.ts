/**
 * Renderer for Lexical `link` and `autolink` nodes.
 *
 * URLs are validated by `isSafeUrl`; unsafe URLs cause the renderer to
 * emit just the link's children, dropping the `<a>` wrapper entirely.
 *
 * External HTTP(S) targets get `target="_blank"` and `rel="noopener
 * noreferrer"` automatically.
 *
 * @module @lexical/nodes/link
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isExternalHttpUrl, isSafeUrl } from '@security/url-validator';
import { register, type NodeRenderer } from '../registry';

const linkRenderer: NodeRenderer = (node, ctx): string => {
  const url = typeof node['url'] === 'string' ? node['url'] : '';
  const children = ctx.renderChildren(node.children ?? []);

  if (url.length === 0 || !isSafeUrl(url)) return children;

  const targetAttr = isExternalHttpUrl(url)
    ? ' target="_blank" rel="noopener noreferrer"'
    : buildOptionalAttrs(node);
  const titleAttr =
    typeof node['title'] === 'string' ? ` title="${escapeHtml(node['title'])}"` : '';
  return `<a href="${escapeHtmlAttribute(url)}"${targetAttr}${titleAttr}>${children}</a>`;
};

/**
 * For non-external links Payload may still embed an explicit `target`.
 * We honour it but never let the consumer skip the `noopener noreferrer`
 * pair for `target="_blank"` — security-critical.
 */
function buildOptionalAttrs(node: Record<string, unknown>): string {
  const target = typeof node['target'] === 'string' ? node['target'] : '';
  if (target.length === 0) return '';
  const safeTarget = escapeHtml(target);
  if (target === '_blank') return ` target="_blank" rel="noopener noreferrer"`;
  return ` target="${safeTarget}"`;
}

register('link', linkRenderer);
register('autolink', linkRenderer);

export { linkRenderer };
