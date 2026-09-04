/**
 * `text` / `textarea` renderer. An element with structured children is left
 * alone (warned once) unless it opts in with `data-payload-text`, so a styled
 * wrapper is not destroyed by a value meant for its text node.
 */

import { isLexicalContent, lexicalToPlainText } from '@lexical/render';
import { trustedHtml } from '@security/trusted-types';
import { escapeAndLinebreak } from '@security/escape';
import { safeConsoleWarn } from '@core/diagnostics';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer, RendererKey } from '@core/types';

const TEXT_OPT_IN_ATTRIBUTE = 'data-payload-text';

/** Build the renderer with its own warn-once state; one per client (ADR 0002). */
export function createTextRenderer(name: RendererKey = 'text'): FieldRenderer {
  const warnedElements = new WeakSet<Element>();

  return {
    name,
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

// `<br>` is this renderer's own multiline output, not a consumer wrapper;
// counting it froze every multiline binding after its first write.
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
