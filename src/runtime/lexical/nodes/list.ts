/** `list` / `listitem` renderers: `bullet` → `<ul>`, `number` → `<ol>`, `check` → `<ul role="list">` with `aria-checked` items. */

import { escapeHtml } from '@security/escape';
import type { NodeRenderer } from '../registry';
import { dirAttribute, layoutClassAttribute } from '../utils';

const listRenderer: NodeRenderer = (node, ctx): string => {
  const listType = typeof node['listType'] === 'string' ? node['listType'] : 'bullet';
  const tag = listType === 'number' ? 'ol' : 'ul';
  const startAttr =
    listType === 'number' && typeof node['start'] === 'number' && node['start'] > 1
      ? ` start="${String(node['start'])}"`
      : '';
  const checkAttr = listType === 'check' ? ' role="list"' : '';
  const children = ctx.renderChildren(node.children ?? []);
  return `<${tag}${dirAttribute(node)}${layoutClassAttribute(node)}${startAttr}${checkAttr}>${children}</${tag}>`;
};

const listItemRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  if (typeof node['checked'] === 'boolean') {
    const state = node['checked'] ? 'true' : 'false';
    return `<li role="checkbox" aria-checked="${state}"${layoutClassAttribute(node)}>${children}</li>`;
  }
  const valueAttr =
    typeof node['value'] === 'number' ? ` value="${escapeHtml(String(node['value']))}"` : '';
  return `<li${dirAttribute(node)}${layoutClassAttribute(node)}${valueAttr}>${children}</li>`;
};

export { listRenderer, listItemRenderer };
