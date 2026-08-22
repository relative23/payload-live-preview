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
import { safeConsoleWarn } from '@core/diagnostics';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer } from '@core/types';

const TEXT_OPT_IN_ATTRIBUTE = 'data-payload-text';

/** Build a text renderer with registration-local warning deduplication state. */
export function createTextRenderer(): FieldRenderer {
  const warnedElements = new WeakSet<Element>();

  return {
    name: 'text',
    render: markNoWriteCallback((target, value) => {
      const element = target.element;
      const text = toPlainString(value);
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        (element as HTMLInputElement | HTMLTextAreaElement).value = text;
        return;
      }
      if (hasStructuredChildren(element) && !element.hasAttribute(TEXT_OPT_IN_ATTRIBUTE)) {
        warnOnce(warnedElements, element, target.fieldName);
        return false;
      }
      if (text.includes('\n') || text.includes('\r')) {
        element.innerHTML = escapeAndLinebreak(text);
        return;
      }
      element.textContent = text;
      return;
    }),
  };
}

function hasStructuredChildren(element: Element): boolean {
  // Elements with at least one element child (not a text node) are
  // considered "structured" — typically a template uses styled wrappers
  // around the actual field value.
  return element.firstElementChild !== null;
}

function warnOnce(warnedElements: WeakSet<Element>, element: Element, fieldName: string): void {
  if (warnedElements.has(element)) return;
  warnedElements.add(element);
  safeConsoleWarn(
    `[live-preview] LP0402: Skipping text update for "${fieldName}": ` +
      `<${element.tagName.toLowerCase()}> has structured children. Move ` +
      `data-payload-field to the value element, or add data-payload-text to replace them.`,
  );
}

function toPlainString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isLexicalContent(value)) return lexicalToPlainText(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
