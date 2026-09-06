/** `number` renderer: raw value on inputs, `Intl.NumberFormat` elsewhere. */

import { detectInitialLocale } from '@detection/locale';
import { getNumberFormat } from '@core/intl-cache';
import type { CachedElement, FieldRenderer, RenderContext } from '@core/types';
import { isEmptyValue, safeStringify } from './utils';
import { formatOptionsFor } from './value-format';

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
    element.textContent = format(num, target, context);
  },
};

function format(num: number, target: CachedElement, context: RenderContext): string {
  const locale = target.locale ?? context.locale ?? detectInitialLocale();
  const options = formatOptionsFor('number', target.format, target.element, target.fieldName);
  try {
    return getNumberFormat(locale, options).format(num);
  } catch {
    // An `Intl` option this build rejects — an unknown currency, say.
    return String(num);
  }
}

export { numberRenderer };
