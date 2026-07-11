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

import { escapeHtml } from '@security/escape';
import { sanitizeHtml } from '@security/sanitizer';
import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';
import { safeStringify } from './utils';

const arrayRenderer: FieldRenderer = {
  name: 'array',
  render(target, value) {
    const element = target.element;
    if (!Array.isArray(value)) return;
    const template = target.arrayTemplate;
    if (template !== undefined && template.length > 0) {
      const html = renderTemplate(template, value);
      element.innerHTML = sanitizeHtml(html);
      return;
    }
    const separator = target.arraySeparator ?? ', ';
    element.textContent = value.map(stringify).join(separator);
  },
};

function renderTemplate(template: string, items: readonly unknown[]): string {
  let out = '';
  for (let i = 0; i < items.length; i += 1) {
    out += interpolate(template, items[i], i);
  }
  return out;
}

function interpolate(template: string, item: unknown, index: number): string {
  let out = template;
  if (typeof item === 'object' && item !== null) {
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      const pattern = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
      out = out.replace(pattern, escapeHtml(safeStringify(value)));
    }
  } else {
    out = out.replace(/\{\{value\}\}/g, escapeHtml(safeStringify(item)));
  }
  out = out.replace(/\{\{index\}\}/g, String(index));
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stringify(value: unknown): string {
  return safeStringify(value);
}

registerBuiltinRenderer(arrayRenderer);
// `blocks` shares the template-driven behaviour.
registerBuiltinRenderer({ ...arrayRenderer, name: 'blocks' });

export { arrayRenderer };
