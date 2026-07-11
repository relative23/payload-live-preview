/**
 * `textarea` field renderer.
 *
 * Differs from `text` only in that newlines are always preserved via
 * `<br>` insertion in non-input elements, even for single-line inputs.
 *
 * @module @field-types/textarea
 */

import { isLexicalContent, lexicalToPlainText } from '@lexical/render';
import { escapeAndLinebreak } from '@security/escape';
import type { FieldRenderer } from '@core/types';
import { registerBuiltinRenderer } from './registry';
import { safeStringify } from './utils';

const textareaRenderer: FieldRenderer = {
  name: 'textarea',
  render(target, value) {
    const element = target.element;
    const text = isLexicalContent(value) ? lexicalToPlainText(value) : safeStringify(value);
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      (element as HTMLInputElement | HTMLTextAreaElement).value = text;
      return;
    }
    element.innerHTML = escapeAndLinebreak(text);
  },
};

registerBuiltinRenderer(textareaRenderer);

export { textareaRenderer };
