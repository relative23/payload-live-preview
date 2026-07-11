/**
 * Renderer for Lexical `text` nodes.
 *
 * Applies every standard format flag in a stable order so identical
 * inputs always produce identical output (important for snapshot tests
 * and tree-diff workflows).
 *
 * @module @lexical/nodes/text
 */

import { escapeHtml } from '@security/escape';
import type { LexicalNode } from '../types';
import { TextFormat } from '../types';
import { register, type NodeRenderer } from '../registry';

const textRenderer: NodeRenderer = (node: LexicalNode): string => {
  const raw = typeof node.text === 'string' ? node.text : '';
  let out = escapeHtml(raw);
  const format = typeof node.format === 'number' ? node.format : 0;
  if ((format & TextFormat.CODE) !== 0) out = `<code>${out}</code>`;
  if ((format & TextFormat.BOLD) !== 0) out = `<strong>${out}</strong>`;
  if ((format & TextFormat.ITALIC) !== 0) out = `<em>${out}</em>`;
  if ((format & TextFormat.UNDERLINE) !== 0) out = `<u>${out}</u>`;
  if ((format & TextFormat.STRIKETHROUGH) !== 0) out = `<s>${out}</s>`;
  if ((format & TextFormat.SUBSCRIPT) !== 0) out = `<sub>${out}</sub>`;
  if ((format & TextFormat.SUPERSCRIPT) !== 0) out = `<sup>${out}</sup>`;
  if ((format & TextFormat.HIGHLIGHT) !== 0) out = `<mark>${out}</mark>`;
  return out;
};

register('text', textRenderer);

export { textRenderer };
