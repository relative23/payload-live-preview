/**
 * Renderer for Lexical `heading` nodes.
 *
 * Validates the `tag` against the standard H1-H6 set; falls back to
 * `h2` for unknown values (Lexical occasionally emits non-standard
 * tags during transient editor states).
 *
 * @module @lexical/nodes/heading
 */

import { register, type NodeRenderer } from '../registry';
import { dirAttribute, styleAttribute } from '../utils';

const VALID_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const headingRenderer: NodeRenderer = (node, ctx): string => {
  const tagRaw = typeof node['tag'] === 'string' ? node['tag'].toLowerCase() : 'h2';
  const tag = VALID_TAGS.has(tagRaw) ? tagRaw : 'h2';
  const children = ctx.renderChildren(node.children ?? []);
  return `<${tag}${dirAttribute(node)}${styleAttribute(node)}>${children}</${tag}>`;
};

register('heading', headingRenderer);

export { headingRenderer };
