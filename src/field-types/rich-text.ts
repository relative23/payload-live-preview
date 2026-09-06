/**
 * `richText` renderer: a Lexical root or an HTML string. A project
 * `renderRichText` takes precedence; its output is sanitised like every
 * other HTML write.
 *
 * The Lexical write keeps the markup the server rendered for a block the
 * registry cannot render, rather than replacing it with the empty placeholder
 * the node renderer produces for one (LP0410).
 */

import { isLexicalContent, lexicalToHtml, type LexicalRenderOptions } from '@lexical/render';
import { UNRENDERED_BLOCK_SELECTOR } from '@lexical/nodes/block';
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
      writeKeepingUnrenderedBlocks(element, sanitizeHtmlWithPolicy(lexical, policy));
      return;
    }
    if (typeof value === 'string') {
      element.innerHTML = trustedHtml(sanitizeHtmlWithPolicy(value, policy));
      return;
    }
    return false;
  }),
};

/**
 * Write `html` into `element`, but move the live element standing where an
 * unrendered block's placeholder stands over into the new tree first. Every
 * pairing is resolved before the first move: a move takes a child out of the
 * live element, which would shift the position each later one is read at.
 */
function writeKeepingUnrenderedBlocks(element: Element, html: string): void {
  const rendered = element.cloneNode(false) as Element;
  rendered.innerHTML = trustedHtml(html);
  if (rendered.querySelector(UNRENDERED_BLOCK_SELECTOR) !== null) {
    const kept: [placeholder: Element, live: Element][] = [];
    pairUnrenderedBlocks(element, rendered, kept);
    for (const [placeholder, live] of kept) placeholder.replaceWith(live);
  }
  element.replaceChildren(...rendered.childNodes);
}

/**
 * Pair each placeholder with the live element in its position. Both trees
 * describe the same document, so position is the only key there is — the server
 * writes no id to match on. Descent stops where the child counts differ: the
 * two do not line up there, nothing is kept, and the placeholder is written,
 * which is what this renderer did before.
 */
function pairUnrenderedBlocks(
  live: Element,
  rendered: Element,
  kept: [placeholder: Element, live: Element][],
): void {
  if (live.children.length !== rendered.children.length) return;
  let liveChild = live.firstElementChild;
  let renderedChild = rendered.firstElementChild;
  // Nothing moves until every pairing is known, so walking siblings is stable.
  while (liveChild !== null && renderedChild !== null) {
    if (renderedChild.matches(UNRENDERED_BLOCK_SELECTOR)) kept.push([renderedChild, liveChild]);
    else pairUnrenderedBlocks(liveChild, renderedChild, kept);
    liveChild = liveChild.nextElementSibling;
    renderedChild = renderedChild.nextElementSibling;
  }
}

export { richTextRenderer };
