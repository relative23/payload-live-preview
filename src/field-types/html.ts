/**
 * `html` field renderer.
 *
 * Used when the consumer explicitly opts into raw-HTML rendering with
 * `data-payload-type="html"`. The value is always run through
 * `sanitizeHtml` first. Non-string values are coerced via `String()`.
 *
 * @module @field-types/html
 */

import { sanitizeHtml } from '@security/sanitizer';
import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';
import { safeStringify } from './utils';

const htmlRenderer: FieldRenderer = {
  name: 'html',
  render(target, value) {
    if (value === null || value === undefined) {
      target.element.textContent = '';
      return;
    }
    const html = typeof value === 'string' ? value : safeStringify(value);
    target.element.innerHTML = sanitizeHtml(html);
  },
};

registerBuiltinRenderer(htmlRenderer);

export { htmlRenderer };
