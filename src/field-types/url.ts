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
import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';
import { safeStringify } from './utils';

const urlRenderer: FieldRenderer = {
  name: 'url',
  render(target, value, context) {
    const element = target.element;
    const text = safeStringify(value);
    if (element.tagName === 'A') {
      const anchor = element as HTMLAnchorElement;
      const hrefField = target.hrefField;
      const hrefSource = hrefField ? context.allFields[hrefField] : value;
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

registerBuiltinRenderer(urlRenderer);

// `email` shares semantics with `url` once the value is set — Payload
// emits a string for both.
registerBuiltinRenderer({ ...urlRenderer, name: 'email' });

export { urlRenderer };
