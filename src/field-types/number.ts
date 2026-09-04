/** `number` renderer: raw value on inputs, `Intl.NumberFormat` elsewhere. */

import { detectInitialLocale } from '@detection/locale';
import { getNumberFormat } from '@core/intl-cache';
import type { FieldRenderer, RenderContext } from '@core/types';
import { isEmptyValue, safeStringify } from './utils';

const numberRenderer: FieldRenderer = {
  name: 'number',
  render(target, value, context) {
    const element = target.element;
    if (isEmptyValue(value)) {
      if (element.tagName === 'INPUT') (element as HTMLInputElement).value = '';
      else element.textContent = '';
      return;
    }
    const num = typeof value === 'number' ? value : Number(safeStringify(value));
    if (Number.isNaN(num)) {
      element.textContent = safeStringify(value);
      return;
    }
    if (element.tagName === 'INPUT') {
      (element as HTMLInputElement).value = String(num);
      return;
    }
    element.textContent = format(num, context);
  },
};

function format(num: number, context: RenderContext): string {
  const locale = context.locale ?? detectInitialLocale();
  try {
    return getNumberFormat(locale).format(num);
  } catch {
    return String(num);
  }
}

export { numberRenderer };
