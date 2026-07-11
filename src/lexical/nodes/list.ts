/**
 * Renderer for Lexical `list` and `listitem` nodes.
 *
 * Recognises three list types:
 *   - `bullet` → `<ul>`
 *   - `number` → `<ol>` (forwards `start` and `reversed` when present)
 *   - `check`  → `<ul role="list">` with `aria-checked` per item
 *
 * @module @lexical/nodes/list
 */

import { escapeHtml } from '@security/escape';
import { register, type NodeRenderer } from '../registry';
import { dirAttribute, styleAttribute } from '../utils';

const listRenderer: NodeRenderer = (node, ctx): string => {
  const listType = typeof node['listType'] === 'string' ? node['listType'] : 'bullet';
  const tag = listType === 'number' ? 'ol' : 'ul';
  const startAttr =
    listType === 'number' && typeof node['start'] === 'number' && node['start'] > 1
      ? ` start="${String(node['start'])}"`
      : '';
  const checkAttr = listType === 'check' ? ' role="list"' : '';
  const children = ctx.renderChildren(node.children ?? []);
  return `<${tag}${dirAttribute(node)}${styleAttribute(node)}${startAttr}${checkAttr}>${children}</${tag}>`;
};

const listItemRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  if (typeof node['checked'] === 'boolean') {
    const state = node['checked'] ? 'true' : 'false';
    return `<li role="checkbox" aria-checked="${state}"${styleAttribute(node)}>${children}</li>`;
  }
  const valueAttr =
    typeof node['value'] === 'number' ? ` value="${escapeHtml(String(node['value']))}"` : '';
  return `<li${dirAttribute(node)}${styleAttribute(node)}${valueAttr}>${children}</li>`;
};

register('list', listRenderer);
register('listitem', listItemRenderer);

export { listRenderer, listItemRenderer };
