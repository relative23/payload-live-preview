/**
 * Top-level Lexical → HTML renderer.
 *
 * Walks the document tree, dispatching each node to the renderer
 * registered for its `type`. Unknown nodes are handled gracefully:
 * children are rendered (so the user sees content), the wrapper is
 * skipped.
 *
 * @module @lexical/render
 */

import { sanitizeHtml, hasSanitizerDocument } from '@security/sanitizer';
import { lookup, register, type RenderNodeContext } from './registry';
import type { LexicalNode, LexicalRoot } from './types';
import { resolveAlignment, resolveIndent } from './utils';

// Named imports + explicit `register()` calls. The previous
// architecture relied on each node module calling `register()` as a
// side effect at import time, but bundlers that honour the package's
// `sideEffects: false` field tree-shake side-effect-only imports.
// Wiring the registry from a single point eliminates that risk —
// every renderer is unambiguously referenced as a value.
import { textRenderer } from './nodes/text';
import { paragraphRenderer } from './nodes/paragraph';
import { headingRenderer } from './nodes/heading';
import { listRenderer, listItemRenderer } from './nodes/list';
import { linkRenderer } from './nodes/link';
import { quoteRenderer } from './nodes/quote';
import { codeRenderer, codeHighlightRenderer } from './nodes/code';
import { linebreakRenderer, horizontalRuleRenderer, tabRenderer } from './nodes/linebreak';
import { uploadRenderer } from './nodes/upload';
import { relationshipRenderer } from './nodes/relationship';
import { blockRenderer } from './nodes/block';

register('text', textRenderer);
register('paragraph', paragraphRenderer);
register('heading', headingRenderer);
register('list', listRenderer);
register('listitem', listItemRenderer);
register('link', linkRenderer);
register('autolink', linkRenderer);
register('quote', quoteRenderer);
register('code', codeRenderer);
register('code-highlight', codeHighlightRenderer);
register('linebreak', linebreakRenderer);
register('horizontalrule', horizontalRuleRenderer);
register('tab', tabRenderer);
register('upload', uploadRenderer);
register('relationship', relationshipRenderer);
register('block', blockRenderer);

const RENDER_CONTEXT: RenderNodeContext = {
  renderChildren,
  resolveAlignment,
  resolveIndent,
};

export interface LexicalRenderOptions {
  /**
   * When `true` (default), the resulting HTML is passed through the
   * isomorphic `sanitizeHtml()` for defence-in-depth.
   */
  readonly sanitize?: boolean;
}

/**
 * Identify whether a value looks like a Lexical root payload.
 */
export function isLexicalContent(value: unknown): value is LexicalRoot {
  if (typeof value !== 'object' || value === null) return false;
  if (!('root' in value)) return false;
  const root = value.root;
  if (typeof root !== 'object' || root === null) return false;
  if (!('children' in root)) return false;
  return Array.isArray(root.children);
}

/**
 * Convert a Lexical root payload to an HTML string. By default the
 * result is sanitised through `sanitizeHtml`. The renderer is
 * security-first; per-node renderers already escape text and validate
 * URLs, but the final sanitiser closes any gap.
 */
export function lexicalToHtml(content: LexicalRoot, options: LexicalRenderOptions = {}): string {
  if (!isLexicalContent(content)) return '';
  const html = renderChildren(content.root.children);
  if (options.sanitize === false) return html;
  // Honour `setSanitizerDocument()` overrides (SSR with linkedom/jsdom)
  // instead of probing the `document` global — otherwise the sanitize
  // backstop would silently disappear server-side even when the
  // consumer wired a DOM for exactly this purpose. Without any DOM the
  // per-node renderers' escaping still guarantees safe output for the
  // built-in node set; custom block renderers should sanitize their own
  // output when SSR-rendering without a sanitizer document.
  if (!hasSanitizerDocument()) return html;
  return sanitizeHtml(html);
}

/**
 * Extract the plain text content of a Lexical document.
 *
 * Paragraphs are separated by `\n`. Used by the text/textarea renderer
 * when a rich-text value is bound to a non-rich-text element.
 */
export function lexicalToPlainText(content: LexicalRoot): string {
  if (!isLexicalContent(content)) return '';
  return content.root.children.map(extractPlainText).join('\n').trim();
}

function renderChildren(children: readonly LexicalNode[]): string {
  let out = '';
  for (const child of children) out += renderNode(child);
  return out;
}

function renderNode(node: LexicalNode): string {
  const renderer = lookup(node.type);
  if (renderer) return renderer(node, RENDER_CONTEXT);
  // Unknown node type — preserve content by rendering children verbatim.
  return node.children !== undefined ? renderChildren(node.children) : '';
}

function extractPlainText(node: LexicalNode): string {
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'linebreak') return '\n';
  if (node.children === undefined) return '';
  let out = '';
  for (const child of node.children) out += extractPlainText(child);
  return out;
}
