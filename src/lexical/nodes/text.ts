/** `text` renderer. Format flags wrap in a fixed order so equal input gives byte-equal output. */

import { escapeHtml } from '@security/escape';
import type { LexicalNode } from '../types';
import { TextFormat } from '../types';
import type { NodeRenderer } from '../registry';

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

export { textRenderer };
