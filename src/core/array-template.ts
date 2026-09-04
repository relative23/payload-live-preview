/**
 * Interpolate one array-item template in a single pass. A replacement value is
 * data, not template syntax: one `replace()` per key would re-interpret
 * `{{index}}` text that an earlier value introduced, and would apply
 * `String.replace`'s `$` semantics to CMS content.
 */

import { escapeHtml } from '@security/escape';

const PLACEHOLDER_PATTERN = /\{\{([\s\S]*?)\}\}/g;

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function interpolateArrayTemplate(
  template: string,
  item: unknown,
  index: number,
  stringify: (value: unknown) => string,
): string {
  const record = typeof item === 'object' && item !== null ? item : null;

  return template.replace(PLACEHOLDER_PATTERN, (placeholder, key: string) => {
    // Preserve the established object-field precedence when an object itself
    // has an `index` or `value` property. Otherwise these are reserved tokens.
    if (record !== null && hasOwn(record, key)) {
      return escapeHtml(stringify(Reflect.get(record, key)));
    }
    if (record === null && key === 'value') return escapeHtml(stringify(item));
    if (key === 'index') return String(index);
    return placeholder;
  });
}
