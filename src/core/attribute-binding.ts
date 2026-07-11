/**
 * Policed attribute writes for `data-payload-attribute` bindings.
 *
 * The binding writes an incoming CMS value into an arbitrary attribute
 * (`<img data-payload-field="hero" data-payload-attribute="src">`,
 * `<time ... data-payload-attribute="datetime">`). Because the value is
 * remote-controlled, the write path enforces:
 *
 *   - no event handlers (`on*`), no `style`, no `srcdoc`,
 *     no `formaction`/`form`, no `id`/`name` (DOM clobbering);
 *   - URL-bearing attributes (`href`, `src`, `poster`, `cite`,
 *     `action`, `xlink:href`) must pass `isSafeUrl`;
 *   - `srcset` is refused outright (multi-URL syntax — bind `src`
 *     instead);
 *   - non-scalar values are refused.
 *
 * @module @core/attribute-binding
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
 * Write `value` to `attribute` on `element`, subject to the policy in
 * the module docblock. Returns `'blocked'` (without touching the DOM)
 * when the write is refused.
 */
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
