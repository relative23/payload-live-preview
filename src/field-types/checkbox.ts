/** `checkbox` renderer: `checked` on an input, `aria-checked` where present, `true`/`false` text otherwise. */

import type { FieldRenderer } from '@core/types';

const FALSE_STRINGS = new Set(['', 'false', '0', 'off', 'no']);

const checkboxRenderer: FieldRenderer = {
  name: 'checkbox',
  render(target, value) {
    const element = target.element;
    const checked = toBoolean(value);
    if (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'checkbox') {
      (element as HTMLInputElement).checked = checked;
      return;
    }
    if (element.hasAttribute('aria-checked')) {
      element.setAttribute('aria-checked', checked ? 'true' : 'false');
      return;
    }
    element.textContent = checked ? 'true' : 'false';
  },
};

// Form state and query parameters arrive as strings; `Boolean('false')` is not an answer.
function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return !FALSE_STRINGS.has(value.trim().toLowerCase());
  if (typeof value === 'number') return value !== 0;
  return value !== null && value !== undefined;
}

export { checkboxRenderer };
