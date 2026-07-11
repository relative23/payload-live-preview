/**
 * Renderer for Lexical `paragraph` nodes.
 *
 * Honours `direction`, `format` (alignment), and `indent`.
 *
 * @module @lexical/nodes/paragraph
 */

import { register, type NodeRenderer } from '../registry';
import { dirAttribute, styleAttribute } from '../utils';

const paragraphRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  return `<p${dirAttribute(node)}${styleAttribute(node)}>${children}</p>`;
};

register('paragraph', paragraphRenderer);

export { paragraphRenderer };
