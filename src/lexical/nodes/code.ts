/**
 * Renderer for Lexical `code` (block-level fenced code) and inline
 * `code-highlight` nodes.
 *
 * Block code: `<pre><code class="language-...">` (language sanitised).
 * Inline highlight tokens: `<code class="...">`.
 *
 * @module @lexical/nodes/code
 */

import { escapeHtml } from '@security/escape';
import { register, type NodeRenderer } from '../registry';
import type { LexicalNode } from '../types';

const codeRenderer: NodeRenderer = (node): string => {
  const language = sanitizeLangClass(typeof node['language'] === 'string' ? node['language'] : '');
  const inner = extractText(node);
  const langClass = language === '' ? '' : ` class="language-${language}"`;
  return `<pre><code${langClass}>${escapeHtml(inner)}</code></pre>`;
};

const codeHighlightRenderer: NodeRenderer = (node): string => {
  const text = typeof node.text === 'string' ? node.text : '';
  const highlight =
    typeof node['highlightType'] === 'string'
      ? ` class="token-${sanitizeLangClass(node['highlightType'])}"`
      : '';
  return `<span${highlight}>${escapeHtml(text)}</span>`;
};

register('code', codeRenderer);
register('code-highlight', codeHighlightRenderer);

export { codeRenderer, codeHighlightRenderer };

function extractText(node: LexicalNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!node.children) return '';
  let out = '';
  for (const child of node.children) out += extractText(child);
  return out;
}

function sanitizeLangClass(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
