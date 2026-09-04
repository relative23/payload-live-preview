/**
 * `select` / `radio` renderer. Form controls receive option values; other
 * elements show the option labels from the field schema when the admin sent
 * one, else the values.
 */

import type { FieldRenderer, RenderContext } from '@core/types';
import { asRecord } from '@lexical/value-shapes';
import { isEmptyValue, safeStringify } from './utils';

const selectRenderer: FieldRenderer = {
  name: 'select',
  render(target, value, context) {
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
    element.textContent = values.map((item) => labelFor(item, context)).join(', ');
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

function labelFor(value: string, context: RenderContext): string {
  const options = context.schema?.['options'];
  if (!Array.isArray(options)) return value;
  for (const option of options) {
    const record = asRecord(option);
    if (record === undefined || safeStringify(record['value']) !== value) continue;
    return typeof record['label'] === 'string' ? record['label'] : value;
  }
  return value;
}

export { selectRenderer };
