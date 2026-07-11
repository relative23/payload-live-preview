/**
 * Renderer for Lexical `quote` nodes.
 *
 * @module @lexical/nodes/quote
 */

import { register, type NodeRenderer } from '../registry';
import { dirAttribute, styleAttribute } from '../utils';

const quoteRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  return `<blockquote${dirAttribute(node)}${styleAttribute(node)}>${children}</blockquote>`;
};

register('quote', quoteRenderer);

export { quoteRenderer };
