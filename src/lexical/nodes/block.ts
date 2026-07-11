/**
 * Renderer for Lexical `block` nodes — Payload's custom-blocks feature
 * (the `BlocksFeature` of `@payloadcms/richtext-lexical`).
 *
 * The Lexical serializer emits a block as:
 *   {
 *     type: 'block',
 *     fields: { blockType: 'callout', text: '...', ... },
 *   }
 *
 * Dispatch order:
 *
 *   1. The blocks sub-registry (`./blocks/registry.ts`) is consulted
 *      first. Consumers opt into the default renderer set via
 *      `registerDefaultBlocks()`; custom slugs override via
 *      `registerBlockRenderer()`.
 *   2. Falling through, the generic renderer emits a
 *      `<div data-block-type="…">` annotated with each field as a
 *      `data-block-<key>` attribute, so consumer CSS / hydration can
 *      pick the block up.
 *
 * @module @lexical/nodes/block
 */

import { escapeHtml } from '@security/escape';
import { lookupBlockRenderer } from '../blocks/registry';
import { register, type NodeRenderer } from '../registry';

const blockRenderer: NodeRenderer = (node, ctx): string => {
  const fields = readFields(node);
  const blockTypeRaw = typeof fields['blockType'] === 'string' ? fields['blockType'] : '';
  const slug = sanitizeIdent(blockTypeRaw);

  if (blockTypeRaw !== '') {
    const custom = lookupBlockRenderer(blockTypeRaw) ?? lookupBlockRenderer(slug);
    if (custom) {
      return custom(fields, { renderChildren: ctx.renderChildren });
    }
  }

  const attrs: string[] = [];
  if (slug !== '') attrs.push(`data-block-type="${escapeHtml(slug)}"`);
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'blockType' || key === 'id') continue;
    if (value === null || value === undefined) continue;
    const stringValue =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
    attrs.push(`data-block-${sanitizeIdent(key)}="${escapeHtml(stringValue)}"`);
  }
  const attrString = attrs.length === 0 ? '' : ` ${attrs.join(' ')}`;
  return `<div${attrString}></div>`;
};

register('block', blockRenderer);

export { blockRenderer };

function readFields(node: Record<string, unknown>): Record<string, unknown> {
  const raw = node['fields'];
  if (typeof raw !== 'object' || raw === null) return {};
  return raw as Record<string, unknown>;
}

function sanitizeIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}
