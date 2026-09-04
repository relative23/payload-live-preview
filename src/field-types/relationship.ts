/** `relationship` renderer: the relation's label as text; on an `<a>` a populated `url` becomes `href`. */

import type { FieldRenderer } from '@core/types';
import { asRecord, pickRelationLabel, type RelationShape } from '@lexical/value-shapes';
import { acceptUrl } from './unsafe-url';
import { isEmptyValue, safeStringify } from './utils';

const relationshipRenderer: FieldRenderer = {
  name: 'relationship',
  render(target, value) {
    const element = target.element;
    if (isEmptyValue(value)) {
      element.removeAttribute('href');
      element.textContent = '';
      return;
    }
    if (element.tagName === 'A' && !Array.isArray(value)) {
      const outcome = acceptUrl(element, target.fieldName, asRecord(value)?.['url']);
      if (outcome.kind === 'safe') element.setAttribute('href', outcome.url);
      else if (outcome.kind === 'unsafe') element.removeAttribute('href');
    }
    element.textContent = Array.isArray(value) ? value.map(label).join(', ') : label(value);
  },
};

function label(value: unknown): string {
  const record = asRecord(value) as RelationShape | undefined;
  if (record === undefined) return safeStringify(value);
  return pickRelationLabel(record) ?? '';
}

export { relationshipRenderer };
