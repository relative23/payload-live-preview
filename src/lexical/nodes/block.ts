/**
 * `block` and `inlineBlock` renderers for Payload's BlocksFeature. The block
 * registry is consulted first; without a renderer for the slug the node becomes
 * an empty, class-tagged element a consumer can style or replace.
 *
 * That element is a placeholder, not a rendering. `UNRENDERED_BLOCK_SELECTOR`
 * names it so the write path can keep the markup the server already rendered
 * for the block in its place, instead of replacing a figure and its image with
 * an empty div (LP0410).
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

const warnedBlockTypes = new Set<string>();

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
    warnMissingRendererOnce(blockType);
  }
  const classes = slug === '' ? baseClass : `${baseClass} ${baseClass}--${slug}`;
  return `<${tag} class="${classes}"></${tag}>`;
}

// This layer may not import `@core/diagnostics` (architecture policy), so the
// warn-once lives here, the same shape as the one in `../render.ts`. It is not
// routed through the runtime's `warn` option for that reason.
function warnMissingRendererOnce(blockType: string): void {
  if (warnedBlockTypes.has(blockType)) return;
  warnedBlockTypes.add(blockType);
  try {
    console.warn(
      `[live-preview] LP0410: no renderer for block "${blockType}"; keeping what the server rendered for it. Register one with registerBlockRenderer().`,
    );
  } catch {
    // Diagnostics never become a second failure.
  }
}

/** Test-only: let LP0410 fire again. */
export function __resetBlockWarningsForTests(): void {
  warnedBlockTypes.clear();
}

const blockRenderer: NodeRenderer = (node, ctx) => renderBlockNode(node, ctx, 'div', 'lp-block');

const inlineBlockRenderer: NodeRenderer = (node, ctx) =>
  renderBlockNode(node, ctx, 'span', 'lp-inline-block');

export { blockRenderer, inlineBlockRenderer };
