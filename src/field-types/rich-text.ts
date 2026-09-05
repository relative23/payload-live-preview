/**
 * `richText` renderer: a Lexical root or an HTML string. A project
 * `renderRichText` takes precedence; its output is sanitised like every
 * other HTML write.
 */

import { isLexicalContent, lexicalToHtml, type LexicalRenderOptions } from '@lexical/render';
import { trustedHtml } from '@security/trusted-types';
import { sanitizeHtmlWithPolicy } from '@security/sanitizer';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer } from '@core/types';
import { isEmptyValue } from './utils';

// Lexical would otherwise sanitise with the process default; the sink below
// does it with the instance's policy instead.
const UNSANITISED: LexicalRenderOptions = { sanitize: false };

const richTextRenderer: FieldRenderer = {
  name: 'richText',
  render: /* @__PURE__ */ markNoWriteCallback((target, value, context) => {
    const element = target.element;
    if (isEmptyValue(value)) {
      element.textContent = '';
      return;
    }
    const policy = context.sanitizerPolicy;
    if (context.renderRichText !== undefined) {
      const html = context.renderRichText(value, {
        fieldName: target.fieldName,
        element,
        locale: context.locale,
      });
      element.innerHTML = trustedHtml(sanitizeHtmlWithPolicy(html, policy));
      return;
    }
    if (isLexicalContent(value)) {
      const lexical = lexicalToHtml(value, UNSANITISED);
      element.innerHTML = trustedHtml(sanitizeHtmlWithPolicy(lexical, policy));
      return;
    }
    if (typeof value === 'string') {
      element.innerHTML = trustedHtml(sanitizeHtmlWithPolicy(value, policy));
      return;
    }
    return false;
  }),
};

export { richTextRenderer };
