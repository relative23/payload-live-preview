import type { NodeRenderer } from '../registry';
import { dirAttribute, layoutClassAttribute } from '../utils';

const quoteRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  return `<blockquote${dirAttribute(node)}${layoutClassAttribute(node)}>${children}</blockquote>`;
};

export { quoteRenderer };
