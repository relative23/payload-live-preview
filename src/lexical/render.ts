/**
 * Lexical → HTML. Each node dispatches to the renderer registered for its
 * `type`; an unknown node renders its children so content is never lost.
 */

import { sanitizeHtml, hasSanitizerDocument } from '@security/sanitizer';
import { lookup, type RenderNodeContext } from './registry';
import type { LexicalNode, LexicalRoot } from './types';
import { resolveAlignment, resolveIndent } from './utils';

const RENDER_CONTEXT: RenderNodeContext = {
  renderChildren,
  resolveAlignment,
  resolveIndent,
};

export interface LexicalRenderOptions {
  /** Pass the result through `sanitizeHtml()` (default `true`). */
  readonly sanitize?: boolean;
}

let warnedNoSanitizer = false;

export function isLexicalContent(value: unknown): value is LexicalRoot {
  if (typeof value !== 'object' || value === null) return false;
  if (!('root' in value)) return false;
  const root = value.root;
  if (typeof root !== 'object' || root === null) return false;
  if (!('children' in root)) return false;
  return Array.isArray(root.children);
}

/** Render a Lexical document to HTML; without `setSanitizerDocument()` the result is unsanitised and warns once. */
export function lexicalToHtml(content: LexicalRoot, options: LexicalRenderOptions = {}): string {
  if (!isLexicalContent(content)) return '';
  const html = renderChildren(content.root.children);
  if (options.sanitize === false) return html;
  if (hasSanitizerDocument()) return sanitizeHtml(html);
  warnNoSanitizerOnce();
  return html;
}

/** Plain text of a document, paragraphs separated by `\n`. */
export function lexicalToPlainText(content: LexicalRoot): string {
  if (!isLexicalContent(content)) return '';
  return content.root.children.map(extractPlainText).join('\n').trim();
}

/** Test-only: allow the SSR warning to fire again. */
export function __resetSanitizerWarningForTests(): void {
  warnedNoSanitizer = false;
}

function renderChildren(children: readonly LexicalNode[]): string {
  let out = '';
  for (const child of children) out += renderNode(child);
  return out;
}

function renderNode(node: LexicalNode): string {
  const renderer = lookup(node.type);
  if (renderer) return renderer(node, RENDER_CONTEXT);
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

// This layer may not import `@core/diagnostics` (architecture policy), so the
// warn-once lives here; a hostile or absent console must not break rendering.
function warnNoSanitizerOnce(): void {
  if (warnedNoSanitizer) return;
  warnedNoSanitizer = true;
  try {
    console.warn(
      '[live-preview] lexicalToHtml() has no sanitizer document and returned unsanitised HTML; ' +
        'call setSanitizerDocument() (linkedom/jsdom) for server rendering, see docs/security.md §3.',
    );
  } catch {
    // Diagnostics never become a second failure.
  }
}
