/** `heading` renderer; an unknown `tag` (transient editor states emit them) falls back to `h2`. */

import type { NodeRenderer } from '../registry';
import { dirAttribute, layoutClassAttribute } from '../utils';

const VALID_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const headingRenderer: NodeRenderer = (node, ctx): string => {
  const tagRaw = typeof node['tag'] === 'string' ? node['tag'].toLowerCase() : 'h2';
  const tag = VALID_TAGS.has(tagRaw) ? tagRaw : 'h2';
  const children = ctx.renderChildren(node.children ?? []);
  return `<${tag}${dirAttribute(node)}${layoutClassAttribute(node)}>${children}</${tag}>`;
};

export { headingRenderer };
