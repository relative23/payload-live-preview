/** `code` (fenced block) and `code-highlight` (token span) renderers. */

import { escapeHtml } from '@security/escape';
import type { NodeRenderer } from '../registry';
import type { LexicalNode } from '../types';
import { sanitizeIdent } from '../value-shapes';

const codeRenderer: NodeRenderer = (node): string => {
  const language = sanitizeIdent(typeof node['language'] === 'string' ? node['language'] : '');
  const langClass = language === '' ? '' : ` class="language-${language}"`;
  return `<pre><code${langClass}>${escapeHtml(extractText(node))}</code></pre>`;
};

const codeHighlightRenderer: NodeRenderer = (node): string => {
  const text = typeof node.text === 'string' ? node.text : '';
  const highlight =
    typeof node['highlightType'] === 'string'
      ? ` class="token-${sanitizeIdent(node['highlightType'])}"`
      : '';
  return `<span${highlight}>${escapeHtml(text)}</span>`;
};

export { codeRenderer, codeHighlightRenderer };

function extractText(node: LexicalNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!node.children) return '';
  let out = '';
  for (const child of node.children) out += extractText(child);
  return out;
}
