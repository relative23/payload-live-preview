/**
 * `select` / `radio` renderer. Form controls receive option values; other
 * elements show the values, since the admin sends no option labels.
 */

import type { FieldRenderer } from '@core/types';
import { isEmptyValue, safeStringify } from './utils';

const selectRenderer: FieldRenderer = {
  name: 'select',
  render(target, value) {
    const element = target.element;
    const values = isEmptyValue(value) ? [] : toValues(value);
    if (element.tagName === 'SELECT') {
      writeSelect(element as HTMLSelectElement, values);
      return;
    }
    if (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'radio') {
      const radio = element as HTMLInputElement;
      radio.checked = values.includes(radio.value);
      return;
    }
    element.textContent = values.join(', ');
  },
};

function toValues(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(safeStringify);
  return [safeStringify(value)];
}

// `.value = 'a, b'` on a multiple select selects nothing; options are set one by one.
function writeSelect(select: HTMLSelectElement, values: readonly string[]): void {
  if (select.multiple) {
    for (const option of Array.from(select.options)) {
      option.selected = values.includes(option.value);
    }
    return;
  }
  select.value = values[0] ?? '';
}

export { selectRenderer };
