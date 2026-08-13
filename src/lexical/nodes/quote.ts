/**
 * Renderer for Lexical `quote` nodes.
 *
 * @module @lexical/nodes/quote
 */

import type { NodeRenderer } from '../registry';
import { dirAttribute, styleAttribute } from '../utils';

const quoteRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  return `<blockquote${dirAttribute(node)}${styleAttribute(node)}>${children}</blockquote>`;
};

export { quoteRenderer };
