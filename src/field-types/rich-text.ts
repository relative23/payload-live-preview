/**
 * `richText` renderer: a Lexical root or an HTML string. A project
 * `renderRichText` takes precedence; its output is sanitised like every
 * other HTML write.
 *
 * The Lexical write keeps the markup the server rendered for a block the
 * registry cannot render, rather than replacing it with the empty placeholder
 * the node renderer produces for one. The verdict is spoken here, after the
 * write, because only the write knows it: LP0410 when the server's markup
 * stands, LP0413 when the two trees did not line up and it is gone — and the
 * second goes through `context.reportUnfaithful` too, which is the case
 * `onUnfaithfulPatch` escalates.
 */

import { isLexicalContent, lexicalToHtml } from '@lexical/render';
import { UNRENDERED_BLOCK_SELECTOR } from '@lexical/nodes/block';
import { trustedHtml } from '@security/trusted-types';
import { sanitizeHtmlWithPolicy } from '@security/sanitizer';
import { safeConsoleWarn } from '@core/diagnostics';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { CachedElement, FieldRenderer, RenderContext } from '@core/types';
import { isEmptyValue } from './utils';

/** Block slugs already reported, one set per verdict: a block kept once may still be lost later. */
const warnedKept = new Set<string>();
const warnedLost = new Set<string>();

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
      // Slug by placeholder class: the class is what the write finds standing.
      const unrendered = new Map<string, string>();
      const lexical = lexicalToHtml(value, {
        // Lexical would otherwise sanitise with the process default; the sink
        // below does it with the instance's policy instead.
        sanitize: false,
        onUnrenderedBlock: (blockType, placeholderClass) => {
          unrendered.set(placeholderClass, blockType);
        },
      });
      const verdicts = writeKeepingUnrenderedBlocks(
        element,
        sanitizeHtmlWithPolicy(lexical, policy),
      );
      for (const [placeholderClass, lost] of verdicts) {
        const blockType = unrendered.get(placeholderClass);
        if (blockType !== undefined) reportUnrenderedBlock(target, context, blockType, lost);
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
 * Returns a verdict per placeholder class: `false` where a live element that
 * was not itself a placeholder took the placeholder's place, `true` where one
 * is still standing over markup the element had — the descent found no
 * counterpart, so this write lost what the server drew for that block. No
 * verdict where there was nothing to keep: a container the page left empty,
 * or a placeholder an earlier write put there, whose loss was reported then.
 */
function writeKeepingUnrenderedBlocks(
  element: Element,
  html: string,
): ReadonlyMap<string, boolean> {
  const rendered = element.cloneNode(false) as Element;
  rendered.innerHTML = trustedHtml(html);
  const verdicts = new Map<string, boolean>();
  const placeholders = rendered.querySelectorAll(UNRENDERED_BLOCK_SELECTOR);
  if (placeholders.length > 0 && element.firstElementChild !== null) {
    const pairs: [placeholder: Element, live: Element][] = [];
    pairUnrenderedBlocks(element, rendered, pairs);
    for (const [placeholder, live] of pairs) {
      placeholder.replaceWith(live);
      if (!live.matches(UNRENDERED_BLOCK_SELECTOR)) verdicts.set(placeholder.className, false);
    }
    // A placeholder the moves left in the tree is one no live element answered for.
    for (const placeholder of placeholders) {
      if (placeholder.parentNode !== null) verdicts.set(placeholder.className, true);
    }
  }
  element.replaceChildren(...rendered.childNodes);
  return verdicts;
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

/**
 * Say what became of a block nobody registered a renderer for, once per slug
 * and verdict. Not through the runtime's `warn` option: a renderer has no
 * channel to it, and `RenderContext` carries the one thing that matters more —
 * the report that lets a strategy redraw the region the write just degraded.
 */
function reportUnrenderedBlock(
  target: CachedElement,
  context: RenderContext,
  blockType: string,
  lost: boolean,
): void {
  if (lost) {
    context.reportUnfaithful?.(target, `lost the markup the server drew for block "${blockType}"`);
  }
  const warned = lost ? warnedLost : warnedKept;
  if (warned.has(blockType)) return;
  warned.add(blockType);
  safeConsoleWarn(
    `[live-preview] ${
      lost
        ? `LP0413: no renderer for block "${blockType}", and the markup the server rendered for it is lost.`
        : `LP0410: no renderer for block "${blockType}"; keeping what the server rendered for it.`
    } Register one with registerBlockRenderer().`,
  );
}

/** Test-only: let LP0410 and LP0413 fire again. */
export function __resetBlockWarningsForTests(): void {
  warnedKept.clear();
  warnedLost.clear();
}

export { richTextRenderer };
