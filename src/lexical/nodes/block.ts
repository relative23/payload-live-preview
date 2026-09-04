/**
 * `block` and `inlineBlock` renderers for Payload's BlocksFeature. The block
 * registry is consulted first; without a renderer for the slug the node
 * becomes an empty, class-tagged element a consumer can style or replace.
 */

import { lookupBlockRenderer } from '../blocks/registry';
import type { NodeRenderer, RenderNodeContext } from '../registry';
import type { LexicalNode } from '../types';
import { asRecord, sanitizeIdent } from '../value-shapes';

function renderBlockNode(
  node: LexicalNode,
  ctx: RenderNodeContext,
  tag: 'div' | 'span',
  baseClass: string,
): string {
  const fields = asRecord(node['fields']) ?? {};
  const blockType = typeof fields['blockType'] === 'string' ? fields['blockType'] : '';
  const slug = sanitizeIdent(blockType);
  if (blockType !== '') {
    const custom = lookupBlockRenderer(blockType) ?? lookupBlockRenderer(slug);
    if (custom) return custom(fields, { renderChildren: ctx.renderChildren });
  }
  const classes = slug === '' ? baseClass : `${baseClass} ${baseClass}--${slug}`;
  return `<${tag} class="${classes}"></${tag}>`;
}

const blockRenderer: NodeRenderer = (node, ctx) => renderBlockNode(node, ctx, 'div', 'lp-block');

const inlineBlockRenderer: NodeRenderer = (node, ctx) =>
  renderBlockNode(node, ctx, 'span', 'lp-inline-block');

export { blockRenderer, inlineBlockRenderer };
