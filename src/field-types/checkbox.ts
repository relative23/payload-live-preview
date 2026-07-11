/**
 * `checkbox` field renderer.
 *
 * `<input type="checkbox">`: updates `checked`.
 * `aria-checked`-capable elements: writes the attribute.
 * Other elements: text content `true` / `false`.
 *
 * @module @field-types/checkbox
 */

import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';

const checkboxRenderer: FieldRenderer = {
  name: 'checkbox',
  render(target, value) {
    const element = target.element;
    const checked = Boolean(value);
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

registerBuiltinRenderer(checkboxRenderer);

export { checkboxRenderer };
