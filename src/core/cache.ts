/**
 * Element cache.
 *
 * Stores the mapping from Payload field name to one-or-more cached
 * DOM bindings. Building the cache once at init (and rebuilding it
 * via MutationObserver) is the foundation of update-time performance:
 * an update walks the cache, not the entire DOM.
 *
 * Cache lookup is O(1) by field name; cache iteration is O(n) over
 * the bound elements only.
 *
 * Notes:
 *   - Field types are inferred from element attributes when not given
 *     explicitly. The resolver lives here so both runtime and tests
 *     share the same logic.
 *   - The cache holds *direct references* to elements — that is fine
 *     for normal lifecycle because we tear down on `destroy()`. We do
 *     not use WeakRefs because we need stable iteration order during
 *     updates.
 *
 * @module @core/cache
 */

import type { CachedElement, ElementPredicate, FieldType } from './types';

export const FIELD_ATTRIBUTE = 'data-payload-field';
export const TYPE_ATTRIBUTE = 'data-payload-type';
export const HREF_ATTRIBUTE = 'data-payload-href';
export const SRC_ATTRIBUTE = 'data-payload-src';
export const ALT_ATTRIBUTE = 'data-payload-alt';
export const ARRAY_TEMPLATE_ATTRIBUTE = 'data-payload-array-template';
export const ARRAY_SEPARATOR_ATTRIBUTE = 'data-payload-array-separator';
export const LOCALE_ATTRIBUTE = 'data-payload-locale';

const FIELD_SELECTOR = `[${FIELD_ATTRIBUTE}]`;

const VALID_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'text',
  'textarea',
  'richText',
  'email',
  'number',
  'checkbox',
  'date',
  'select',
  'radio',
  'array',
  'blocks',
  'group',
  'tabs',
  'row',
  'collapsible',
  'relationship',
  'upload',
  'point',
  'json',
  'code',
  'ui',
  'html',
  'url',
  'image',
  'structural-array',
]);

/**
 * Statistics produced after each cache rebuild.
 */
export interface CacheBuildStats {
  readonly elementCount: number;
  readonly fieldCount: number;
  readonly durationMs: number;
}

export interface ElementCacheOptions {
  /** Predicate restricting which elements are accepted. Defaults to "accept all". */
  readonly filter?: ElementPredicate;
}

/**
 * Element cache built from `data-payload-field` annotations.
 *
 * Multiple elements can share the same field name; iteration order
 * within a field is insertion order, mirroring DOM order when built
 * via `buildFromRoot()`.
 */
export class ElementCache {
  readonly #entries = new Map<string, CachedElement[]>();
  readonly #elementToEntry = new WeakMap<Element, CachedElement>();
  readonly #filter: ElementPredicate;

  constructor(options: ElementCacheOptions = {}) {
    this.#filter = options.filter ?? alwaysTrue;
  }

  /**
   * Rebuild the cache from `root`'s descendants. Pre-existing entries
   * are discarded. Returns build statistics so callers can emit
   * cache-refresh events with the durations populated.
   */
  buildFromRoot(root: ParentNode): CacheBuildStats {
    const t0 = performance.now();
    this.#entries.clear();

    const elements = root.querySelectorAll(FIELD_SELECTOR);
    let elementCount = 0;
    for (const element of elements) {
      if (!this.#filter(element)) continue;
      const entry = this.#resolveBinding(element);
      if (!entry) continue;
      this.#append(entry);
      this.#elementToEntry.set(element, entry);
      elementCount += 1;
    }

    return {
      elementCount,
      fieldCount: this.#entries.size,
      durationMs: performance.now() - t0,
    };
  }

  /**
   * Insert a single element into the cache, returning the new entry
   * (or `undefined` if the element does not declare a valid binding).
   */
  add(element: Element): CachedElement | undefined {
    if (!this.#filter(element)) return undefined;
    const entry = this.#resolveBinding(element);
    if (!entry) return undefined;
    this.#append(entry);
    this.#elementToEntry.set(element, entry);
    return entry;
  }

  /**
   * Remove the entry bound to `element`, if any. Returns `true` when a
   * binding was actually removed.
   */
  remove(element: Element): boolean {
    const entry = this.#elementToEntry.get(element);
    if (!entry) return false;
    this.#elementToEntry.delete(element);
    const bucket = this.#entries.get(entry.fieldName);
    if (!bucket) return false;
    const index = bucket.indexOf(entry);
    if (index < 0) return false;
    bucket.splice(index, 1);
    if (bucket.length === 0) this.#entries.delete(entry.fieldName);
    return true;
  }

  /** Returns the cached bindings for `fieldName`, or `undefined`. */
  get(fieldName: string): readonly CachedElement[] | undefined {
    return this.#entries.get(fieldName);
  }

  /** Returns the cache entry for `element`, or `undefined`. */
  getByElement(element: Element): CachedElement | undefined {
    return this.#elementToEntry.get(element);
  }

  /** Number of distinct field names currently cached. */
  get fieldCount(): number {
    return this.#entries.size;
  }

  /** Total number of cached element bindings. */
  get elementCount(): number {
    let count = 0;
    for (const bucket of this.#entries.values()) count += bucket.length;
    return count;
  }

  /** Iterate `[fieldName, bindings]` pairs. */
  entries(): IterableIterator<[string, readonly CachedElement[]]> {
    return this.#entries.entries() as IterableIterator<[string, readonly CachedElement[]]>;
  }

  /** Iterate every cached binding. */
  *values(): IterableIterator<CachedElement> {
    for (const bucket of this.#entries.values()) yield* bucket;
  }

  /** Test whether `element` is registered with the cache. */
  has(element: Element): boolean {
    return this.#elementToEntry.has(element);
  }

  /** Remove every entry. */
  clear(): void {
    this.#entries.clear();
  }

  #append(entry: CachedElement): void {
    const bucket = this.#entries.get(entry.fieldName);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    this.#entries.set(entry.fieldName, [entry]);
  }

  #resolveBinding(element: Element): CachedElement | undefined {
    const fieldName = element.getAttribute(FIELD_ATTRIBUTE);
    if (fieldName === null || fieldName.length === 0) return undefined;
    const explicit = element.getAttribute(TYPE_ATTRIBUTE);
    const fieldType = resolveFieldType(element);
    const hrefField = element.getAttribute(HREF_ATTRIBUTE);
    const srcField = element.getAttribute(SRC_ATTRIBUTE);
    const altField = element.getAttribute(ALT_ATTRIBUTE);
    const arrayTemplate = element.getAttribute(ARRAY_TEMPLATE_ATTRIBUTE);
    const arraySeparator = element.getAttribute(ARRAY_SEPARATOR_ATTRIBUTE);
    const locale = element.getAttribute(LOCALE_ATTRIBUTE);

    const entry: CachedElement = {
      element,
      fieldName,
      fieldType,
      explicitFieldType: explicit !== null && VALID_FIELD_TYPES.has(explicit as FieldType),
      ...(hrefField !== null ? { hrefField } : {}),
      ...(srcField !== null ? { srcField } : {}),
      ...(altField !== null ? { altField } : {}),
      ...(arrayTemplate !== null ? { arrayTemplate } : {}),
      ...(arraySeparator !== null ? { arraySeparator } : {}),
      ...(locale !== null ? { locale } : {}),
    };
    return entry;
  }
}

/**
 * Resolve the field type for an element by combining the explicit
 * `data-payload-type` attribute with element-tag heuristics. Falls
 * back to `text`.
 */
export function resolveFieldType(element: Element): FieldType {
  const explicit = element.getAttribute(TYPE_ATTRIBUTE);
  if (explicit !== null && VALID_FIELD_TYPES.has(explicit as FieldType)) {
    return explicit as FieldType;
  }
  if (element.hasAttribute('data-payload-richtext')) return 'richText';
  if (element.hasAttribute('data-payload-html')) return 'html';
  if (element.hasAttribute('data-payload-structural')) return 'structural-array';
  if (element.hasAttribute('data-payload-array')) return 'array';
  if (element.tagName === 'IMG') return 'image';
  if (element.tagName === 'A') return 'url';
  if (element.tagName === 'TIME') return 'date';
  if (element.tagName === 'INPUT') {
    const inputType = (element as HTMLInputElement).type;
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'number') return 'number';
    if (inputType === 'date' || inputType === 'datetime-local') return 'date';
  }
  return 'text';
}

function alwaysTrue(): boolean {
  return true;
}
