/**
 * Policed writes for `data-payload-attribute` bindings. The value is
 * remote-controlled, so event handlers, `style`, `srcdoc`, `formaction`/`form`,
 * `id`/`name` (DOM clobbering) and `srcset` (multi-URL syntax) are refused,
 * URL-bearing attributes must pass `isSafeUrl`, and non-scalars never write.
 */

import { isSafeUrl } from '@security/url-validator';

const BLOCKED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'style',
  'srcdoc',
  'formaction',
  'form',
  'id',
  'name',
  'is',
  'srcset',
  'imagesrcset',
]);

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'poster',
  'cite',
  'action',
  'xlink:href',
  'data',
]);

export type AttributeApplyResult = 'applied' | 'blocked';

/**
 * Whether this package may write an attribute of this name at all — event
 * handlers, `style`, the two DOM-clobbering names and the multi-URL ones
 * excluded. One rule, two callers: the binding below writes a remote value into
 * it, and the array renderers copy one from the page's own markup onto an item
 * they rebuilt (`src/core/array-template.ts`).
 */
export function isWritableAttribute(name: string): boolean {
  return !name.startsWith('on') && !BLOCKED_ATTRIBUTES.has(name);
}

/** Returns `'blocked'` without touching the DOM when the write is refused. */
export function applyAttributeBinding(
  element: Element,
  attribute: string,
  value: unknown,
): AttributeApplyResult {
  const name = attribute.toLowerCase().trim();
  if (name.length === 0) return 'blocked';
  if (!isWritableAttribute(name)) return 'blocked';

  if (value === null || value === undefined) {
    element.removeAttribute(name);
    return 'applied';
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return 'blocked';
  }
  const stringValue = String(value);

  if (URL_ATTRIBUTES.has(name) && !isSafeUrl(stringValue)) return 'blocked';

  element.setAttribute(name, stringValue);
  return 'applied';
}
