/**
 * `block` and `inlineBlock` renderers for Payload's BlocksFeature. The block
 * registry is consulted first; without a renderer for the slug the node becomes
 * an empty, class-tagged element a consumer can style or replace.
 *
 * That element is a placeholder, not a rendering. `UNRENDERED_BLOCK_SELECTOR`
 * names it so the write path can keep the markup the server already rendered
 * for the block in its place, instead of replacing a figure and its image with
 * an empty div (LP0410). Whether that succeeds is decided there, not here: this
 * renderer only tells the context which slug it had no renderer for, and the
 * write says what became of it (LP0410 kept, LP0413 lost).
 */

import { lookupBlockRenderer } from '../blocks/registry';
import type { NodeRenderer, RenderNodeContext } from '../registry';
import type { LexicalNode } from '../types';
import { asRecord, sanitizeIdent } from '../value-shapes';

/**
 * The placeholders above, in the rendered tree. Both are empty by construction,
 * and a registered renderer's output is not: it carries the block's content and
 * its own class (`lp-block-callout`, …).
 */
export const UNRENDERED_BLOCK_SELECTOR = '.lp-block:empty,.lp-inline-block:empty';

function renderBlockNode(
  node: LexicalNode,
  ctx: RenderNodeContext,
  tag: 'div' | 'span',
  baseClass: string,
): string {
  const fields = asRecord(node['fields']) ?? {};
  const blockType = typeof fields['blockType'] === 'string' ? fields['blockType'] : '';
  const slug = sanitizeIdent(blockType);
  const classes = slug === '' ? baseClass : `${baseClass} ${baseClass}--${slug}`;
  if (blockType !== '') {
    const custom = lookupBlockRenderer(blockType) ?? lookupBlockRenderer(slug);
    if (custom) return custom(fields, { renderChildren: ctx.renderChildren });
    // The real slug is known only here — the class carries `sanitizeIdent(slug)`,
    // and a hint that names the wrong one to register is no hint.
    ctx.onUnrenderedBlock?.(blockType, classes);
  }
  return `<${tag} class="${classes}"></${tag}>`;
}

const blockRenderer: NodeRenderer = (node, ctx) => renderBlockNode(node, ctx, 'div', 'lp-block');

const inlineBlockRenderer: NodeRenderer = (node, ctx) =>
  renderBlockNode(node, ctx, 'span', 'lp-inline-block');

export { blockRenderer, inlineBlockRenderer };
