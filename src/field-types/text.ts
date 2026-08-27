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
import { trustedHtml } from '@security/trusted-types';
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
    render: /* @__PURE__ */ markNoWriteCallback((target, value) => {
      const element = target.element;
      const text = toPlainString(value);
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        (element as HTMLInputElement | HTMLTextAreaElement).value = text;
        return;
      }
      if (hasForeignChildren(element) && !element.hasAttribute(TEXT_OPT_IN_ATTRIBUTE)) {
        warnOnce(warnedElements, element, target.fieldName);
        return false;
      }
      if (text.includes('\n') || text.includes('\r')) {
        element.innerHTML = trustedHtml(escapeAndLinebreak(text));
        return;
      }
      element.textContent = text;
      return;
    }),
  };
}

/**
 * Whether the element has an element child this renderer did not put there.
 *
 * The guard below preserves a styled wrapper around the value rather than
 * destroying it. `<br>` is excluded because it is this renderer's own output:
 * a multiline value is written as `innerHTML` with `<br>` separators, so
 * counting those as foreign made the second update to a multiline field
 * refuse because of what the first one wrote, freezing that binding for the
 * rest of the session. An element whose children are only line breaks is not
 * a wrapper — it is the value.
 */
function hasForeignChildren(element: Element): boolean {
  return element.querySelector(':scope > :not(br)') !== null;
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
