/**
 * `date` field renderer.
 *
 * Uses `Intl.DateTimeFormat` with the active locale (defaults to
 * `navigator.language`, never the legacy hard-coded `'de'`). Recognises
 * `<time>` elements and updates their `datetime` attribute for SEO and
 * accessibility.
 *
 * @module @field-types/date
 */

import { detectInitialLocale } from '@detection/locale';
import { getDateTimeFormat } from '@core/intl-cache';
import type { FieldRenderer, RenderContext } from '@core/types';
import { registerBuiltinRenderer } from './registry';
import { safeStringify } from './utils';

const dateRenderer: FieldRenderer = {
  name: 'date',
  render(target, value, context) {
    const element = target.element;
    if (value === null || value === undefined || value === '') {
      if (element.tagName === 'INPUT') {
        (element as HTMLInputElement).value = '';
      } else if (element.tagName === 'TIME') {
        element.removeAttribute('datetime');
        element.textContent = '';
      } else {
        element.textContent = '';
      }
      return;
    }
    const iso = typeof value === 'string' ? value : safeStringify(value);
    const date = new Date(iso);
    const isValid = !Number.isNaN(date.getTime());
    if (element.tagName === 'INPUT') {
      (element as HTMLInputElement).value = isValid
        ? toIsoForInput((element as HTMLInputElement).type, date)
        : iso;
      return;
    }
    if (element.tagName === 'TIME') {
      element.setAttribute('datetime', isValid ? date.toISOString() : iso);
      element.textContent = isValid ? formatDate(date, context) : iso;
      return;
    }
    element.textContent = isValid ? formatDate(date, context) : iso;
  },
};

function formatDate(date: Date, context: RenderContext): string {
  const locale = context.locale ?? detectInitialLocale();
  try {
    return getDateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return date.toISOString();
  }
}

function toIsoForInput(type: string, date: Date): string {
  if (type === 'date') return date.toISOString().slice(0, 10);
  if (type === 'datetime-local') return date.toISOString().slice(0, 16);
  return date.toISOString();
}

registerBuiltinRenderer(dateRenderer);

export { dateRenderer };
