/**
 * `richText` renderer: a Lexical root or an HTML string. A project
 * `renderRichText` takes precedence; its output is sanitised like every
 * other HTML write.
 *
 * The Lexical write keeps the markup the server rendered for a block the
 * registry cannot render, rather than replacing it with the empty placeholder
 * the node renderer produces for one, and it keeps the wrapper a template put
 * around the whole field. The verdict is spoken here, after the write, because
 * only the write knows it: LP0410 when the server's markup stands, LP0413 when
 * the two trees did not line up and it is gone — and the second goes through
 * `context.reportUnfaithful` too, which is the case `onUnfaithfulPatch`
 * escalates.
 */

import { isLexicalContent, lexicalToHtml } from '@lexical/render';
import { UNRENDERED_BLOCK_SELECTOR } from '@lexical/nodes/block';
import { trustedHtml } from '@security/trusted-types';
import { sanitizeHtmlWithPolicy } from '@security/sanitizer';
import { isEmptyLexicalRoot } from '@core/binding-writer';
import { FIELD_ATTRIBUTE } from '@core/cache';
import { safeConsoleWarn } from '@core/diagnostics';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { CachedElement, FieldRenderer, RenderContext } from '@core/types';
import { isEmptyValue } from './utils';

/** Block slugs already reported, one set per verdict: a block kept once may still be lost later. */
const warnedKept = new Set<string>();
const warnedLost = new Set<string>();

/** The containers a template wraps rich text in; Lexical renders none of them for content. */
const WRAPPER_TAGS: ReadonlySet<string> = new Set(['DIV', 'SECTION', 'ARTICLE']);

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
      // Empty paragraphs only: cleared as `null` is. A project renderer above decides for itself.
      if (isEmptyLexicalRoot(value)) {
        element.textContent = '';
        return;
      }
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
  const target = wrapperOf(element, rendered) ?? element;
  const verdicts = new Map<string, boolean>();
  const placeholders = rendered.querySelectorAll(UNRENDERED_BLOCK_SELECTOR);
  if (placeholders.length > 0 && target.firstElementChild !== null) {
    const pairs: [placeholder: Element, live: Element][] = [];
    pairUnrenderedBlocks(target, rendered, pairs);
    for (const [placeholder, live] of pairs) {
      placeholder.replaceWith(live);
      if (!live.matches(UNRENDERED_BLOCK_SELECTOR)) verdicts.set(placeholder.className, false);
    }
    // A placeholder the moves left in the tree is one no live element answered for.
    for (const placeholder of placeholders) {
      if (placeholder.parentNode !== null) verdicts.set(placeholder.className, true);
    }
  }
  target.replaceChildren(...rendered.childNodes);
  return verdicts;
}

/**
 * The one wrapper a template puts around rich text when the server renders it
 * — `<div class="prose">` around the blocks, the usual Tailwind shape — or
 * `null` when the rendered document is written straight into `element`. The
 * wrapper stays, because the typography hangs on its class, and the pairing
 * runs inside it, where the blocks are; without this the live tree had one
 * child where the rendered one had five, and the descent stopped before it
 * reached the block (measured on the demo, Z29).
 *
 * A wrapper is the element's only child, of a kind Lexical does not render
 * content as, with no binding of its own, standing where the rendered document
 * has elements unlike it: a `<div>` a registered block renders is content, and
 * the paragraph typed after it must not be written into it. A document of one
 * element keeps the wrapper too, unless that element is a placeholder or of
 * the wrapper's own tag: then the wrapper may be the block the server drew, and
 * the positional pairing answers for it.
 */
function wrapperOf(element: Element, rendered: Element): Element | null {
  const child = element.firstElementChild;
  const only = rendered.children.length === 1 ? rendered.firstElementChild : null;
  if (child?.nextElementSibling !== null || rendered.children.length === 0) return null;
  if (!WRAPPER_TAGS.has(child.tagName) || child.hasAttribute(FIELD_ATTRIBUTE)) return null;
  if (only?.tagName === child.tagName || only?.matches(UNRENDERED_BLOCK_SELECTOR) === true) {
    return null;
  }
  for (const block of rendered.children) {
    if (block.tagName === child.tagName && block.className === child.className) return null;
  }
  return child;
}

/**
 * Pair each placeholder with the live element in its position. Both trees
 * describe the same document, so position is the only key there is — the server
 * writes no id to match on. Where the child counts differ, an edit added or
 * removed a node somewhere in between: the pairing walks in from both ends and
 * stops at the first two that cannot be one node, two tags, or a placeholder
 * against an element of a tag the document renders beside it. A placeholder
 * left in between is written, which is what this renderer did before.
 */
function pairUnrenderedBlocks(
  live: Element,
  rendered: Element,
  kept: [placeholder: Element, live: Element][],
): void {
  const pair = (block: Element, element: Element): void => {
    if (block.matches(UNRENDERED_BLOCK_SELECTOR)) kept.push([block, element]);
    else pairUnrenderedBlocks(element, block, kept);
  };
  // Nothing moves until every pairing is known, so walking siblings is stable.
  let element = live.firstElementChild;
  let block = rendered.firstElementChild;
  if (live.children.length === rendered.children.length) {
    for (; element !== null && block !== null; element = element.nextElementSibling) {
      pair(block, element);
      block = block.nextElementSibling;
    }
    return;
  }
  const tags = new Set<string>();
  for (const child of rendered.children) {
    if (!child.matches(UNRENDERED_BLOCK_SELECTOR)) tags.add(child.tagName);
  }
  const fits = (candidate: Element, standing: Element): boolean =>
    candidate.matches(UNRENDERED_BLOCK_SELECTOR)
      ? !tags.has(standing.tagName)
      : candidate.tagName === standing.tagName;
  let front = 0;
  for (; element !== null && block !== null && fits(block, element); front += 1) {
    pair(block, element);
    element = element.nextElementSibling;
    block = block.nextElementSibling;
  }
  const shorter = Math.min(live.children.length, rendered.children.length);
  element = live.lastElementChild;
  block = rendered.lastElementChild;
  for (let back = front; back < shorter && element !== null && block !== null; back += 1) {
    if (!fits(block, element)) return;
    pair(block, element);
    element = element.previousElementSibling;
    block = block.previousElementSibling;
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
