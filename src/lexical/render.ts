/**
 * Lexical → HTML. Each node dispatches to the renderer registered for its
 * `type`; an unknown node renders its children so content is never lost.
 */

import { sanitizeHtml, hasSanitizerDocument, type SanitizerDocument } from '@security/sanitizer';
import { lookup, type RenderNodeContext } from './registry';
import type { LexicalNode, LexicalRoot } from './types';
import { resolveAlignment, resolveIndent } from './utils';

export interface LexicalRenderOptions {
  /** Pass the result through `sanitizeHtml()` (default `true`). */
  readonly sanitize?: boolean;
  /**
   * The DOM the sanitizer parses with, for this call: an SSR document such as
   * linkedom's or jsdom's. Without it the global one is used; with neither the
   * call throws, unless `requireDocument: false` asks for the markup as it is.
   */
  readonly document?: SanitizerDocument;
  /**
   * Throw instead of returning unsanitised HTML when no document is available:
   * the `SanitizerEnvironmentError` `sanitizeHtml()` throws (ADR 0025). The
   * default since 3.0 (ADR 0007, row 18). `false` is the 2.x behaviour: the call
   * warns once and returns the markup unsanitised.
   */
  readonly requireDocument?: boolean;
  /**
   * Called for every `block` or `inlineBlock` the registry has no renderer
   * for, with the block's slug as Payload sent it, the class its empty
   * placeholder carries and the block's fields. The `richText` write listens: it is the one caller
   * that later knows whether the server's markup for the block survived, so
   * the diagnostic is spoken there (LP0410, LP0413), not here.
   */
  readonly onUnrenderedBlock?: (
    blockType: string,
    placeholderClass: string,
    fields: unknown,
  ) => void;
  /**
   * The route of an internal link whose document has no `url` of its own, such
   * as `/{locale}/{slug}/`. `{slug}`, `{id}`, `{collection}` and `{locale}` are
   * filled in and encoded; with one of them empty the link falls back to `/<slug>`.
   */
  readonly internalLinkPattern?: string | undefined;
  /** What `{locale}` reads in `internalLinkPattern`. */
  readonly locale?: string | undefined;
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

/** Render a Lexical document to sanitised HTML; without a document it throws, or under `requireDocument: false` returns the markup unsanitised and warns once. */
export function lexicalToHtml(content: LexicalRoot, options: LexicalRenderOptions = {}): string {
  if (!isLexicalContent(content)) return '';
  const html = createContext(options).renderChildren(content.root.children);
  if (options.sanitize === false) return html;
  if (options.document !== undefined) return sanitizeHtml(html, { document: options.document });
  // Without a DOM this throws the sanitizer's own error.
  if (options.requireDocument !== false || hasSanitizerDocument()) return sanitizeHtml(html);
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
function createContext(options: LexicalRenderOptions): RenderNodeContext {
  const context: RenderNodeContext = {
    renderChildren: (children) => {
      let out = '';
      for (const child of children) out += renderNode(child, context);
      return out;
    },
    resolveAlignment,
    resolveIndent,
    onUnrenderedBlock: options.onUnrenderedBlock,
    internalLinkPattern: options.internalLinkPattern,
    locale: options.locale,
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
      '[live-preview] lexicalToHtml() has no sanitizer document and returned unsanitised HTML, ' +
        'as { requireDocument: false } asked; pass { document } (linkedom, jsdom) per call. ' +
        'See "HTML sanitization" in docs/security.md.',
    );
  } catch {
    // Diagnostics never become a second failure.
  }
}
