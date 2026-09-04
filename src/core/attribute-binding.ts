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

/** Returns `'blocked'` without touching the DOM when the write is refused. */
export function applyAttributeBinding(
  element: Element,
  attribute: string,
  value: unknown,
): AttributeApplyResult {
  const name = attribute.toLowerCase().trim();
  if (name.length === 0) return 'blocked';
  if (name.startsWith('on')) return 'blocked';
  if (BLOCKED_ATTRIBUTES.has(name)) return 'blocked';

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
