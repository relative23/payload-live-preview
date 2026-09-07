/**
 * `richText` renderer: a Lexical root or an HTML string. A project
 * `renderRichText` takes precedence; its output is sanitised like every
 * other HTML write.
 *
 * The Lexical write keeps the markup the server rendered for a block the
 * registry cannot render, rather than replacing it with the empty placeholder
 * the node renderer produces for one (LP0410). Where the two trees do not line
 * up there is nothing to keep, and the write says so through
 * `context.reportUnfaithful` — that is the case `onUnfaithfulPatch` escalates.
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
      if (!writeKeepingUnrenderedBlocks(element, sanitizeHtmlWithPolicy(lexical, policy))) {
        context.reportUnfaithful?.(target, 'lost the markup the server drew for a block');
      }
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
 *
 * `false` when a placeholder is still standing over markup the element had —
 * the descent found no counterpart for it, so this write is about to lose what
 * the server drew for that block. An element that had nothing to lose (a
 * container the page left empty) is not that case.
 */
function writeKeepingUnrenderedBlocks(element: Element, html: string): boolean {
  const hadMarkup = element.firstElementChild !== null;
  const rendered = element.cloneNode(false) as Element;
  rendered.innerHTML = trustedHtml(html);
  let kept = true;
  if (rendered.querySelector(UNRENDERED_BLOCK_SELECTOR) !== null) {
    const pairs: [placeholder: Element, live: Element][] = [];
    pairUnrenderedBlocks(element, rendered, pairs);
    for (const [placeholder, live] of pairs) placeholder.replaceWith(live);
    kept = !hadMarkup || rendered.querySelector(UNRENDERED_BLOCK_SELECTOR) === null;
  }
  element.replaceChildren(...rendered.childNodes);
  return kept;
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
