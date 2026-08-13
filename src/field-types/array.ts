/**
 * `array` / `blocks` field renderer.
 *
 * Supports two modes:
 *
 *   1. **Template mode** (consumer sets `data-payload-array-template`):
 *      each array item is interpolated into the template. Placeholders
 *      are `{{key}}` for object fields, `{{value}}` for primitives,
 *      and `{{index}}` for the loop counter. All replacements go
 *      through `escapeHtml`.
 *
 *   2. **Separator mode** (no template): primitives are joined by
 *      `data-payload-array-separator` (default `", "`). Object items
 *      are serialised via `JSON.stringify` so the consumer sees the
 *      raw data instead of `[object Object]`.
 *
 * @module @field-types/array
 */

import { sanitizeHtml } from '@security/sanitizer';
import { interpolateArrayTemplate } from '@core/array-template';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer } from '@core/types';
import { safeStringify } from './utils';

const arrayRenderer: FieldRenderer = {
  name: 'array',
  render: markNoWriteCallback((target, value) => {
    const element = target.element;
    if (!Array.isArray(value)) return false;
    const template = target.arrayTemplate;
    if (template !== undefined && template.length > 0) {
      const html = renderTemplate(template, value);
      element.innerHTML = sanitizeHtml(html);
      return;
    }
    const separator = target.arraySeparator ?? ', ';
    element.textContent = value.map(stringify).join(separator);
    return;
  }),
};

function renderTemplate(template: string, items: readonly unknown[]): string {
  let out = '';
  for (let i = 0; i < items.length; i += 1) {
    out += interpolate(template, items[i], i);
  }
  return out;
}

function interpolate(template: string, item: unknown, index: number): string {
  return interpolateArrayTemplate(template, item, index, safeStringify);
}

function stringify(value: unknown): string {
  return safeStringify(value);
}

export { arrayRenderer };
