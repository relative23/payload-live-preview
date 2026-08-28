import type { NodeRenderer } from '../registry';
import { dirAttribute, layoutClassAttribute } from '../utils';

const paragraphRenderer: NodeRenderer = (node, ctx): string => {
  const children = ctx.renderChildren(node.children ?? []);
  return `<p${dirAttribute(node)}${layoutClassAttribute(node)}>${children}</p>`;
};

export { paragraphRenderer };
