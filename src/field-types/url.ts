/**
 * `url`/`email` field renderer.
 *
 * Sets the text content to the value and, when the element is an
 * `<a>`, updates the `href` attribute as well — pulling from a sibling
 * field when `data-payload-href` is set.
 *
 * @module @field-types/url
 */

import { isSafeUrl } from '@security/url-validator';
import { resolveFieldValue } from '@core/field-value';
import type { FieldRenderer } from '@core/types';
import { safeStringify } from './utils';

const urlRenderer: FieldRenderer = {
  name: 'url',
  render(target, value, context) {
    const element = target.element;
    const text = safeStringify(value);
    if (element.tagName === 'A') {
      const anchor = element as HTMLAnchorElement;
      const hrefField = target.hrefField;
      const hrefSource =
        hrefField === undefined || hrefField.length === 0
          ? value
          : resolveFieldValue(
              context.allFields,
              hrefField,
              context.locale,
              target.locale !== undefined,
            );
      if (typeof hrefSource === 'string' && isSafeUrl(hrefSource)) {
        anchor.href = hrefSource;
      }
      anchor.textContent = text;
      return;
    }
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      (element as HTMLInputElement | HTMLTextAreaElement).value = text;
      return;
    }
    element.textContent = text;
  },
};

export { urlRenderer };
