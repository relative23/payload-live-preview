/**
 * `link` / `autolink` renderer. Payload 3.x serialises links as
 * `{ fields: { linkType, url, newTab, doc } }`; vanilla Lexical puts `url`
 * and `target` on the node itself. Both shapes are read, Payload's first.
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isExternalHttpUrl, isSafeUrl } from '@security/url-validator';
import type { NodeRenderer } from '../registry';
import type { LexicalNode } from '../types';
import { asRecord } from '../value-shapes';

const BLANK_TARGET = ' target="_blank" rel="noopener noreferrer"';

const linkRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  const fields = asRecord(node['fields']);
  const url = resolveUrl(node, fields);
  if (url === undefined || !isSafeUrl(url)) return children;
  const titleAttr =
    typeof node['title'] === 'string' ? ` title="${escapeHtml(node['title'])}"` : '';
  return `<a href="${escapeHtmlAttribute(url)}"${targetAttribute(node, fields, url)}${titleAttr}>${children}</a>`;
};

function resolveUrl(
  node: LexicalNode,
  fields: Record<string, unknown> | undefined,
): string | undefined {
  if (fields?.['linkType'] === 'internal') return internalUrl(fields['doc']);
  const url = fields?.['url'] ?? node['url'];
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

/** An internal link needs the populated document; a bare id has no route to offer. */
function internalUrl(doc: unknown): string | undefined {
  const value = asRecord(asRecord(doc)?.['value']);
  const url = value?.['url'];
  if (typeof url === 'string' && url.length > 0) return url;
  const slug = value?.['slug'];
  return typeof slug === 'string' && slug.length > 0 ? `/${slug}` : undefined;
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
