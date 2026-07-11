/**
 * `text` field renderer.
 *
 * Accepts any scalar and renders it via `textContent` (which is XSS-
 * safe by definition). Lexical content is reduced to plain text so
 * the renderer can serve as a sensible fallback for non-rich-text
 * bindings.
 *
 * Defensive design: when the bound element has structured *element*
 * children (not just text), replacing `textContent` would nuke that
 * markup. The renderer detects this case and:
 *
 *   - If the element has `data-payload-text` → still does the replace
 *     (explicit opt-in: "yes I want my structured markup nuked").
 *   - Otherwise → logs a one-time console warning and skips the write,
 *     preserving the consumer's layout. This protects against the
 *     common annotation mistake of decorating a container that holds
 *     styled children instead of plain text.
 *
 * @module @field-types/text
 */

import { isLexicalContent, lexicalToPlainText } from '@lexical/render';
import { escapeAndLinebreak } from '@security/escape';
import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';

const TEXT_OPT_IN_ATTRIBUTE = 'data-payload-text';
const warnedElements = new WeakSet<Element>();

const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    const element = target.element;
    const text = toPlainString(value);
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      (element as HTMLInputElement | HTMLTextAreaElement).value = text;
      return;
    }
    if (hasStructuredChildren(element) && !element.hasAttribute(TEXT_OPT_IN_ATTRIBUTE)) {
      warnOnce(element, target.fieldName);
      return;
    }
    if (text.includes('\n') || text.includes('\r')) {
      element.innerHTML = escapeAndLinebreak(text);
      return;
    }
    element.textContent = text;
  },
};

function hasStructuredChildren(element: Element): boolean {
  // Elements with at least one element child (not a text node) are
  // considered "structured" — typically a template uses styled wrappers
  // around the actual field value.
  return element.firstElementChild !== null;
}

function warnOnce(element: Element, fieldName: string): void {
  if (warnedElements.has(element)) return;
  warnedElements.add(element);
  console.warn(
    `[live-preview] Skipping text update for "${fieldName}" — the bound ` +
      `<${element.tagName.toLowerCase()}> has structured child elements. ` +
      `Either move data-payload-field to the element whose textContent is the ` +
      `field value, or opt in with data-payload-text to replace the structure.`,
  );
}

function toPlainString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isLexicalContent(value)) return lexicalToPlainText(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

registerBuiltinRenderer(textRenderer);

export { textRenderer };
