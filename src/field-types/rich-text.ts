/**
 * `richText` renderer: a Lexical root or an HTML string. A project
 * `renderRichText` takes precedence; its output is sanitised like every
 * other HTML write.
 */

import { isLexicalContent, lexicalToHtml } from '@lexical/render';
import { trustedHtml } from '@security/trusted-types';
import { sanitizeHtml } from '@security/sanitizer';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer } from '@core/types';
import { isEmptyValue } from './utils';

const richTextRenderer: FieldRenderer = {
  name: 'richText',
  render: /* @__PURE__ */ markNoWriteCallback((target, value, context) => {
    const element = target.element;
    if (isEmptyValue(value)) {
      element.textContent = '';
      return;
    }
    if (context.renderRichText !== undefined) {
      const html = context.renderRichText(value, {
        fieldName: target.fieldName,
        element,
        locale: context.locale,
      });
      element.innerHTML = trustedHtml(sanitizeHtml(html));
      return;
    }
    if (isLexicalContent(value)) {
      element.innerHTML = trustedHtml(lexicalToHtml(value));
      return;
    }
    if (typeof value === 'string') {
      element.innerHTML = trustedHtml(sanitizeHtml(value));
      return;
    }
    return false;
  }),
};

export { richTextRenderer };
