/**
 * `date` renderer. `<time>` gets an ISO `datetime` plus a localised label;
 * date inputs get the value in the visitor's local time zone, because that is
 * what the control displays.
 */

import { detectInitialLocale } from '@detection/locale';
import { getDateTimeFormat } from '@core/intl-cache';
import type { FieldRenderer, RenderContext } from '@core/types';
import { isEmptyValue, safeStringify } from './utils';

const dateRenderer: FieldRenderer = {
  name: 'date',
  render(target, value, context) {
    const element = target.element;
    if (isEmptyValue(value)) {
      if (element.tagName === 'INPUT') (element as HTMLInputElement).value = '';
      else {
        element.removeAttribute('datetime');
        element.textContent = '';
      }
      return;
    }
    const raw = typeof value === 'number' ? value : safeStringify(value);
    const date = new Date(raw);
    const valid = !Number.isNaN(date.getTime());
    const fallback = String(raw);
    if (element.tagName === 'INPUT') {
      (element as HTMLInputElement).value = valid
        ? formatForInput((element as HTMLInputElement).type, date)
        : fallback;
      return;
    }
    if (element.tagName === 'TIME') {
      element.setAttribute('datetime', valid ? date.toISOString() : fallback);
    }
    element.textContent = valid ? formatDate(date, context) : fallback;
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

/** Value for `<input type="date|datetime-local|time">` in local time; other inputs get the ISO instant. */
export function formatForInput(type: string, date: Date): string {
  const day = `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (type === 'date') return day;
  if (type === 'datetime-local') return `${day}T${clock}`;
  if (type === 'time') return clock;
  return date.toISOString();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export { dateRenderer };
