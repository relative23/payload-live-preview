/** `html` renderer (`data-payload-type="html"`): the value is sanitised, then injected. */

import { sanitizeHtmlWithPolicy } from '@security/sanitizer';
import { trustedHtml } from '@security/trusted-types';
import type { FieldRenderer } from '@core/types';
import { isEmptyValue, safeStringify } from './utils';

const htmlRenderer: FieldRenderer = {
  name: 'html',
  render(target, value, context) {
    if (isEmptyValue(value)) {
      target.element.textContent = '';
      return;
    }
    const html = typeof value === 'string' ? value : safeStringify(value);
    target.element.innerHTML = trustedHtml(sanitizeHtmlWithPolicy(html, context.sanitizerPolicy));
  },
};

export { htmlRenderer };
