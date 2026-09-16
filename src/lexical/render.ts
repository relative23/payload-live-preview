/**
 * Lexical → HTML. Each node dispatches to the renderer registered for its
 * `type`; an unknown node renders its children so content is never lost.
 */

import { sanitizeHtml, hasSanitizerDocument } from '@security/sanitizer';
import { lookup, type RenderNodeContext } from './registry';
import type { LexicalNode, LexicalRoot } from './types';
import { resolveAlignment, resolveIndent } from './utils';

export interface LexicalRenderOptions {
  /** Pass the result through `sanitizeHtml()` (default `true`). */
  readonly sanitize?: boolean;
  /**
   * Called for every `block` or `inlineBlock` the registry has no renderer
   * for, with the block's slug as Payload sent it and the class its empty
   * placeholder carries. The `richText` write listens: it is the one caller
   * that later knows whether the server's markup for the block survived, so
   * the diagnostic is spoken there (LP0410, LP0413), not here.
   */
  readonly onUnrenderedBlock?: (blockType: string, placeholderClass: string) => void;
}

let warnedNoSanitizer = false;

/** @internal */
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
  const html = createContext(options.onUnrenderedBlock).renderChildren(content.root.children);
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

/**
 * One context per document: `renderChildren` closes over it so a nested
 * block — a `block` inside a list item, an `inlineBlock` inside a paragraph —
 * reports to the same listener as a top-level one.
 */
function createContext(
  onUnrenderedBlock: RenderNodeContext['onUnrenderedBlock'],
): RenderNodeContext {
  const context: RenderNodeContext = {
    renderChildren: (children) => {
      let out = '';
      for (const child of children) out += renderNode(child, context);
      return out;
    },
    resolveAlignment,
    resolveIndent,
    onUnrenderedBlock,
  };
  return context;
}

function renderNode(node: LexicalNode, context: RenderNodeContext): string {
  const renderer = lookup(node.type);
  if (renderer) return renderer(node, context);
  return node.children !== undefined ? context.renderChildren(node.children) : '';
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
        'call setSanitizerDocument() (linkedom/jsdom) for server rendering, see "HTML sanitization" in docs/security.md.',
    );
  } catch {
    // Diagnostics never become a second failure.
  }
}
