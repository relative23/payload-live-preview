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

import {
  dependencyMapFromBinding,
  mergeDependencyMaps,
  parseDependencyList,
  type DependencyMap,
} from './dependencies';
import type { CachedElement, ElementPredicate, FieldType, RendererKey } from './types';

export const FIELD_ATTRIBUTE = 'data-payload-field';
export const TYPE_ATTRIBUTE = 'data-payload-type';
export const TARGET_ATTRIBUTE_ATTRIBUTE = 'data-payload-attribute';
export const HREF_ATTRIBUTE = 'data-payload-href';
export const SRC_ATTRIBUTE = 'data-payload-src';
export const ALT_ATTRIBUTE = 'data-payload-alt';
export const ARRAY_TEMPLATE_ATTRIBUTE = 'data-payload-array-template';
export const ARRAY_SEPARATOR_ATTRIBUTE = 'data-payload-array-separator';
export const LOCALE_ATTRIBUTE = 'data-payload-locale';
export const RICH_TEXT_ATTRIBUTE = 'data-payload-richtext';
export const HTML_ATTRIBUTE = 'data-payload-html';
export const ARRAY_ATTRIBUTE = 'data-payload-array';
export const STRUCTURAL_ATTRIBUTE = 'data-payload-structural';
export const OWNER_ATTRIBUTE = 'data-payload-owner';
export const DEPENDS_ATTRIBUTE = 'data-payload-depends';
export const STRATEGY_ATTRIBUTE = 'data-payload-strategy';
export const BOUNDARY_ATTRIBUTE = 'data-payload-boundary';
export const INPUT_TYPE_ATTRIBUTE = 'type';

/**
 * Attributes whose values are captured in a {@link CachedElement} snapshot.
 *
 * Mutation observation consumes this list directly. Keep the cache resolver
 * and observer filter coupled here so adding binding metadata cannot leave
 * already-mounted elements with stale cached values.
 */
export const BINDING_ATTRIBUTES: readonly string[] = [
  FIELD_ATTRIBUTE,
  TYPE_ATTRIBUTE,
  TARGET_ATTRIBUTE_ATTRIBUTE,
  HREF_ATTRIBUTE,
  SRC_ATTRIBUTE,
  ALT_ATTRIBUTE,
  ARRAY_TEMPLATE_ATTRIBUTE,
  ARRAY_SEPARATOR_ATTRIBUTE,
  LOCALE_ATTRIBUTE,
  RICH_TEXT_ATTRIBUTE,
  HTML_ATTRIBUTE,
  ARRAY_ATTRIBUTE,
  STRUCTURAL_ATTRIBUTE,
  OWNER_ATTRIBUTE,
  INPUT_TYPE_ATTRIBUTE,
];

const FIELD_SELECTOR = `[${FIELD_ATTRIBUTE}]`;
const OWNER_SELECTOR = `[${OWNER_ATTRIBUTE}]`;

/**
 * Resolve the document a binding belongs to from its nearest marked ancestor,
 * the element itself included.
 *
 * Nearest-ancestor resolution lets a shell component own a whole subtree
 * without repeating the marker on every safe text child, and lets a nested
 * document (a card inside a page) override the owner it inherits.
 */
export function resolveBindingOwner(element: Element): string | undefined {
  const owner = element.closest(OWNER_SELECTOR)?.getAttribute(OWNER_ATTRIBUTE);
  return owner === null || owner === undefined || owner.length === 0 ? undefined : owner;
}

/** `namespace:name` — a project renderer key; never a typo of a built-in type. */
const CUSTOM_RENDERER_KEY = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/i;

function isRendererKey(value: string): value is RendererKey {
  return VALID_FIELD_TYPES.has(value as FieldType) || CUSTOM_RENDERER_KEY.test(value);
}

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
  #elementToEntry = new WeakMap<Element, CachedElement>();
  readonly #filter: ElementPredicate;

  constructor(options: ElementCacheOptions = {}) {
    this.#filter = options.filter ?? alwaysTrue;
  }

  /**
   * Rebuild the cache from `root`'s descendants. Pre-existing entries
   * are discarded. Returns build statistics so callers can emit
   * cache-refresh events with the durations populated.
   */
  /**
   * Source → dependents declared by `data-payload-depends` on cached
   * bindings, in the shape the runtime's `dependencies` option uses.
   */
  dependencyMap(): DependencyMap {
    const maps: DependencyMap[] = [];
    for (const bindings of this.#entries.values()) {
      for (const binding of bindings) {
        if (binding.dependsOn !== undefined) {
          maps.push(dependencyMapFromBinding(binding.fieldName, binding.dependsOn));
        }
      }
    }
    return mergeDependencyMaps(...maps);
  }

  buildFromRoot(root: ParentNode): CacheBuildStats {
    const t0 = performance.now();
    this.clear();

    const elements = root.querySelectorAll(FIELD_SELECTOR);
    let elementCount = 0;
    for (const element of elements) {
      if (this.add(element) !== undefined) elementCount += 1;
    }

    return {
      elementCount,
      fieldCount: this.#entries.size,
      durationMs: performance.now() - t0,
    };
  }

  /**
   * Insert or replace a single element's binding, returning the new entry.
   *
   * The element identity is unique in the cache. Re-adding it refreshes its
   * complete metadata snapshot without duplicating the binding. If its new
   * state is filtered or invalid, any previous binding is removed.
   */
  add(element: Element): CachedElement | undefined {
    // Resolve first so a throwing consumer filter cannot partially mutate a
    // previously valid registration. Once resolved, replacement is one
    // synchronous operation with no externally observable intermediate state.
    const entry = this.#filter(element) ? this.#resolveBinding(element) : undefined;
    const previous = this.#elementToEntry.get(element);

    if (entry === undefined) {
      if (previous !== undefined) this.#removeEntry(element, previous);
      return undefined;
    }

    if (previous !== undefined && this.#replaceEntry(previous, entry)) {
      this.#elementToEntry.set(element, entry);
      return entry;
    }

    if (previous !== undefined) this.#removeEntry(element, previous);
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
    return this.#removeEntry(element, entry);
  }

  /** Replace in place when the field bucket is unchanged, preserving order. */
  #replaceEntry(previous: CachedElement, next: CachedElement): boolean {
    if (previous.fieldName !== next.fieldName) return false;
    const bucket = this.#entries.get(previous.fieldName);
    if (!bucket) return false;
    const index = bucket.indexOf(previous);
    if (index < 0) return false;
    bucket[index] = next;
    return true;
  }

  #removeEntry(element: Element, entry: CachedElement): boolean {
    const bucket = this.#entries.get(entry.fieldName);
    if (!bucket) {
      this.#elementToEntry.delete(element);
      return false;
    }
    const index = bucket.indexOf(entry);
    if (index < 0) {
      this.#elementToEntry.delete(element);
      return false;
    }
    bucket.splice(index, 1);
    if (bucket.length === 0) this.#entries.delete(entry.fieldName);
    this.#elementToEntry.delete(element);
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
    // WeakMap has no clear operation. Replacing it is required so callers
    // retaining a detached Element cannot observe stale cache membership.
    this.#elementToEntry = new WeakMap<Element, CachedElement>();
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
    const targetAttribute = element.getAttribute(TARGET_ATTRIBUTE_ATTRIBUTE);
    const hrefField = element.getAttribute(HREF_ATTRIBUTE);
    const srcField = element.getAttribute(SRC_ATTRIBUTE);
    const altField = element.getAttribute(ALT_ATTRIBUTE);
    const arrayTemplate = element.getAttribute(ARRAY_TEMPLATE_ATTRIBUTE);
    const arraySeparator = element.getAttribute(ARRAY_SEPARATOR_ATTRIBUTE);
    const locale = element.getAttribute(LOCALE_ATTRIBUTE);
    const owner = resolveBindingOwner(element);
    const dependsOn = parseDependencyList(element.getAttribute(DEPENDS_ATTRIBUTE));
    const strategy = element.getAttribute(STRATEGY_ATTRIBUTE);

    const entry: CachedElement = {
      element,
      fieldName,
      fieldType,
      explicitFieldType: explicit !== null && isRendererKey(explicit),
      ...(targetAttribute !== null && targetAttribute.length > 0 ? { targetAttribute } : {}),
      ...(hrefField !== null && hrefField.length > 0 ? { hrefField } : {}),
      ...(srcField !== null && srcField.length > 0 ? { srcField } : {}),
      ...(altField !== null && altField.length > 0 ? { altField } : {}),
      ...(arrayTemplate !== null ? { arrayTemplate } : {}),
      ...(arraySeparator !== null ? { arraySeparator } : {}),
      ...(locale !== null && locale.length > 0 ? { locale } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      ...(strategy !== null && strategy.length > 0 ? { strategy } : {}),
      ...(element.hasAttribute(BOUNDARY_ATTRIBUTE) ? { boundary: true } : {}),
    };
    return entry;
  }
}

/**
 * Resolve the field type for an element by combining the explicit
 * `data-payload-type` attribute with element-tag heuristics. Falls
 * back to `text`.
 */
export function resolveFieldType(element: Element): RendererKey {
  const explicit = element.getAttribute(TYPE_ATTRIBUTE);
  if (explicit !== null && isRendererKey(explicit)) return explicit;
  if (element.hasAttribute(RICH_TEXT_ATTRIBUTE)) return 'richText';
  if (element.hasAttribute(HTML_ATTRIBUTE)) return 'html';
  if (element.hasAttribute(STRUCTURAL_ATTRIBUTE)) return 'structural-array';
  if (element.hasAttribute(ARRAY_ATTRIBUTE)) return 'array';
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
