/**
 * `richText` field renderer.
 *
 * Accepts a Lexical root payload (Payload 3.x) or a plain HTML string
 * (Slate legacy + future-proofing). HTML goes through `sanitizeHtml`
 * before being injected; Lexical content is already sanitised by
 * `lexicalToHtml`.
 *
 * @module @field-types/rich-text
 */

import { isLexicalContent, lexicalToHtml } from '@lexical/render';
import { trustedHtml } from '@security/trusted-types';
import { sanitizeHtml } from '@security/sanitizer';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer } from '@core/types';

const richTextRenderer: FieldRenderer = {
  name: 'richText',
  render: markNoWriteCallback((target, value, context) => {
    // A project renderer, when configured, renders every value — Lexical or
    // not — and its output passes the sanitizer like everything else here.
    if (context.renderRichText !== undefined) {
      target.element.innerHTML = trustedHtml(
        sanitizeHtml(
          context.renderRichText(value, {
            fieldName: target.fieldName,
            element: target.element,
            locale: context.locale,
          }),
        ),
      );
      return;
    }
    if (isLexicalContent(value)) {
      target.element.innerHTML = trustedHtml(lexicalToHtml(value));
      return;
    }
    if (typeof value === 'string') {
      target.element.innerHTML = trustedHtml(sanitizeHtml(value));
      return;
    }
    return false;
  }),
};

export { richTextRenderer };
