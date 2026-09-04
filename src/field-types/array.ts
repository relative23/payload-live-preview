/**
 * `array` / `blocks` renderer. With `data-payload-array-template` each item
 * is interpolated into the template (`{{key}}`, `{{value}}`, `{{index}}`);
 * without one, items are joined by `data-payload-array-separator`.
 */

import { sanitizeHtml } from '@security/sanitizer';
import { trustedHtml } from '@security/trusted-types';
import { interpolateArrayTemplate } from '@core/array-template';
import { markNoWriteCallback } from '@core/internal-outcome';
import { templateSanitizeOptions } from '@core/template-sanitize';
import type { FieldRenderer } from '@core/types';
import { isEmptyValue, safeStringify } from './utils';

const arrayRenderer: FieldRenderer = {
  name: 'array',
  render: /* @__PURE__ */ markNoWriteCallback((target, value) => {
    const element = target.element;
    if (isEmptyValue(value)) {
      element.textContent = '';
      return;
    }
    if (!Array.isArray(value)) return false;
    const template = target.arrayTemplate;
    if (template !== undefined && template.length > 0) {
      const html = renderTemplate(template, value);
      element.innerHTML = trustedHtml(sanitizeHtml(html, templateSanitizeOptions(template)));
      return;
    }
    element.textContent = value.map(safeStringify).join(target.arraySeparator ?? ', ');
    return;
  }),
};

function renderTemplate(template: string, items: readonly unknown[]): string {
  let out = '';
  for (let i = 0; i < items.length; i += 1) {
    out += interpolateArrayTemplate(template, items[i], i, safeStringify);
  }
  return out;
}

export { arrayRenderer };
