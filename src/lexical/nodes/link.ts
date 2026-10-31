/**
 * `link` / `autolink` renderer. Payload 3.x serialises links as
 * `{ fields: { linkType, url, newTab, doc } }`; vanilla Lexical puts `url`
 * and `target` on the node itself. Both shapes are read, Payload's first.
 *
 * An internal link's address is a route only the site knows. The document's own
 * `url` wins, then `internalLinkPattern`, then `/<slug>`, which is all that can be
 * said without either.
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isExternalHttpUrl, isSafeUrl } from '@security/url-validator';
import type { NodeRenderer, RenderNodeContext } from '../registry';
import type { LexicalNode } from '../types';
import { asRecord } from '../value-shapes';

const PLACEHOLDER = /\{(slug|id|collection|locale)\}/gu;
const BLANK_TARGET = ' target="_blank" rel="noopener noreferrer"';

const linkRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  const fields = asRecord(node['fields']);
  const url = resolveUrl(node, fields, ctx);
  if (url === undefined || !isSafeUrl(url)) return children;
  const titleAttr =
    typeof node['title'] === 'string' ? ` title="${escapeHtml(node['title'])}"` : '';
  return `<a href="${escapeHtmlAttribute(url)}"${targetAttribute(node, fields, url)}${titleAttr}>${children}</a>`;
};

function resolveUrl(
  node: LexicalNode,
  fields: Record<string, unknown> | undefined,
  ctx: RenderNodeContext,
): string | undefined {
  if (fields?.['linkType'] === 'internal') return internalUrl(fields['doc'], ctx);
  const url = fields?.['url'] ?? node['url'];
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

/** Without a pattern an internal link needs the populated document; a bare id offers no route. */
function internalUrl(doc: unknown, ctx: RenderNodeContext): string | undefined {
  const relation = asRecord(doc);
  const value = asRecord(relation?.['value']);
  const url = value?.['url'];
  if (typeof url === 'string' && url.length > 0) return url;
  const patterned =
    ctx.internalLinkPattern === undefined
      ? undefined
      : fillPattern(ctx.internalLinkPattern, {
          slug: value?.['slug'],
          id: value === undefined ? relation?.['value'] : value['id'],
          collection: relation?.['relationTo'],
          locale: ctx.locale,
        });
  if (patterned !== undefined) return patterned;
  const slug = value?.['slug'];
  return typeof slug === 'string' && slug.length > 0 ? `/${slug}` : undefined;
}

/** `undefined` when a placeholder the pattern names has no value: half a route is a wrong one. */
function fillPattern(pattern: string, parts: Record<string, unknown>): string | undefined {
  const read = (name: string): string | undefined => {
    const part = parts[name];
    return (typeof part === 'string' && part.length > 0) || typeof part === 'number'
      ? encodeURIComponent(part)
      : undefined;
  };
  for (const [, name = ''] of pattern.matchAll(PLACEHOLDER)) {
    if (read(name) === undefined) return undefined;
  }
  return pattern.replace(PLACEHOLDER, (_match, name: string) => read(name) ?? '');
}

/** `_blank` always carries `noopener noreferrer`, whichever side asked for it. */
function targetAttribute(
  node: LexicalNode,
  fields: Record<string, unknown> | undefined,
  url: string,
): string {
  if (fields?.['newTab'] === true || isExternalHttpUrl(url)) return BLANK_TARGET;
  const target = typeof node['target'] === 'string' ? node['target'] : '';
  if (target === '') return '';
  if (target === '_blank') return BLANK_TARGET;
  return ` target="${escapeHtml(target)}"`;
}

export { linkRenderer };
