/**
 * `select` / `radio` field renderer.
 *
 * For `<select>` and `<input type="radio">` elements: updates the
 * value/checked state. For arbitrary elements: text content.
 *
 * For has-many `select` fields the value is an array — we render the
 * joined labels.
 *
 * @module @field-types/select
 */

import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';
import { safeStringify } from './utils';

const selectRenderer: FieldRenderer = {
  name: 'select',
  render(target, value) {
    const element = target.element;
    const text = stringify(value);
    if (element.tagName === 'SELECT') {
      (element as HTMLSelectElement).value = text;
      return;
    }
    if (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'radio') {
      const radio = element as HTMLInputElement;
      radio.checked = radio.value === text;
      return;
    }
    element.textContent = text;
  },
};

function stringify(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => stringify(v)).join(', ');
  return safeStringify(value);
}

registerBuiltinRenderer(selectRenderer);
registerBuiltinRenderer({ ...selectRenderer, name: 'radio' });

export { selectRenderer };
