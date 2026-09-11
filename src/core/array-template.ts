/**
 * One array item out of one template: the interpolation, and the attributes the
 * template cannot know about.
 *
 * A replacement value is data, not template syntax: one `replace()` per key
 * would re-interpret `{{index}}` text that an earlier value introduced, and
 * would apply `String.replace`'s `$` semantics to CMS content.
 */

import { escapeHtml } from '@security/escape';
import { isWritableAttribute } from './attribute-binding';

const PLACEHOLDER_PATTERN = /\{\{([\s\S]*?)\}\}/g;

/** The runtime's own annotations; a rebuilt item gets its own, never a copy. */
const BINDING_ATTRIBUTE_PREFIX = 'data-payload-';

/** An attribute name and its value, as they travel from an old item to a new one. */
export type InheritedAttribute = readonly [name: string, value: string];

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function interpolateArrayTemplate(
  template: string,
  item: unknown,
  index: number,
  stringify: (value: unknown) => string,
): string {
  const record = typeof item === 'object' && item !== null ? item : null;

  return template.replace(PLACEHOLDER_PATTERN, (placeholder, key: string) => {
    // Preserve the established object-field precedence when an object itself
    // has an `index` or `value` property. Otherwise these are reserved tokens.
    if (record !== null && hasOwn(record, key)) {
      return escapeHtml(stringify(Reflect.get(record, key)));
    }
    if (record === null && key === 'value') return escapeHtml(stringify(item));
    if (key === 'index') return String(index);
    return placeholder;
  });
}

/**
 * What the items already in `container` all carry, and an item rebuilt from the
 * template therefore has to carry too.
 *
 * A framework's scoped styles hang on a marker its compiler writes into the
 * markup — Astro's `data-astro-cid-…`, Vue's `data-v-…`, Svelte's class — and
 * the author's `data-payload-array-template` has none of it. The rebuilt list
 * then renders unstyled next to the one the server sent, while the write itself
 * succeeds, so nothing in the runtime can notice. Naming no framework is the
 * point: what identifies these attributes is that every item of the list has
 * them with the same value, which per-row state by definition does not.
 */
export function sharedItemAttributes(container: Element): readonly InheritedAttribute[] {
  const items = container.children;
  const first = items[0];
  if (first === undefined) return [];
  const shared: InheritedAttribute[] = [];
  for (const { name, value } of Array.from(first.attributes)) {
    if (!isWritableAttribute(name) || name.startsWith(BINDING_ATTRIBUTE_PREFIX)) continue;
    let everyItem = true;
    for (let index = 1; index < items.length && everyItem; index += 1) {
      everyItem = items[index]?.getAttribute(name) === value;
    }
    if (everyItem) shared.push([name, value]);
  }
  return shared;
}

/** Give a rebuilt item what its predecessors shared; the template's own value wins. */
export function inheritItemAttributes(item: Element, shared: readonly InheritedAttribute[]): void {
  for (const [name, value] of shared) {
    if (!item.hasAttribute(name)) item.setAttribute(name, value);
  }
}
