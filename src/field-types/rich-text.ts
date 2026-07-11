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
import { sanitizeHtml } from '@security/sanitizer';
import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';

const richTextRenderer: FieldRenderer = {
  name: 'richText',
  render(target, value) {
    if (isLexicalContent(value)) {
      target.element.innerHTML = lexicalToHtml(value);
      return;
    }
    if (typeof value === 'string') {
      target.element.innerHTML = sanitizeHtml(value);
    }
  },
};

registerBuiltinRenderer(richTextRenderer);

export { richTextRenderer };
