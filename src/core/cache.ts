/**
 * Maps field names to their bound elements so an update walks the cache, not
 * the DOM. Everything an update needs about a binding is resolved here, once,
 * at build time.
 */

import {
  dependencyMapFromBinding,
  mergeDependencyMaps,
  parseDependencyList,
  type DependencyMap,
} from './dependencies';
import { collectIslands } from './islands';
import { enclosingFragment, resolveStrategy } from './strategies';
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
 * Attributes captured in a `CachedElement`. The mutation observer watches
 * exactly this list, so a snapshot can never go stale on a mounted element.
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
  DEPENDS_ATTRIBUTE,
  STRATEGY_ATTRIBUTE,
  BOUNDARY_ATTRIBUTE,
  INPUT_TYPE_ATTRIBUTE,
];

const FIELD_SELECTOR = `[${FIELD_ATTRIBUTE}]`;
const OWNER_SELECTOR = `[${OWNER_ATTRIBUTE}]`;

/** The document a binding belongs to: its nearest `data-payload-owner`, itself included. */
export function resolveBindingOwner(element: Element): string | undefined {
  const owner = element.closest(OWNER_SELECTOR)?.getAttribute(OWNER_ATTRIBUTE);
  return owner === null || owner === undefined || owner.length === 0 ? undefined : owner;
}

/** `namespace:name` — a project renderer key can never be a typo of a built-in type. */
const CUSTOM_RENDERER_KEY = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/i;

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

function isRendererKey(value: string): value is RendererKey {
  return VALID_FIELD_TYPES.has(value as FieldType) || CUSTOM_RENDERER_KEY.test(value);
}

export interface CacheBuildStats {
  readonly elementCount: number;
  readonly fieldCount: number;
  readonly durationMs: number;
}

export interface ElementCacheOptions {
  /** Restricts which elements are accepted. Defaults to all. */
  readonly filter?: ElementPredicate;
}

/**
 * Elements share a field name when the same field is rendered in several
 * places; within a field the order is DOM order.
 */
export class ElementCache {
  private readonly entriesByField = new Map<string, CachedElement[]>();
  private entryByElement = new WeakMap<Element, CachedElement>();
  private readonly filter: ElementPredicate;
  private count = 0;
  private dependencies: DependencyMap | null = null;
  private islandRoots: readonly Element[] = [];

  constructor(options: ElementCacheOptions = {}) {
    this.filter = options.filter ?? alwaysTrue;
  }

  /** Source → dependents declared with `data-payload-depends`; memoised until the cache changes. */
  dependencyMap(): DependencyMap {
    if (this.dependencies !== null) return this.dependencies;
    const maps: DependencyMap[] = [];
    for (const binding of this.values()) {
      if (binding.dependsOn !== undefined) {
        maps.push(dependencyMapFromBinding(binding.fieldName, binding.dependsOn));
      }
    }
    this.dependencies = mergeDependencyMaps(...maps);
    return this.dependencies;
  }

  /** Island roots under the last built root, for update events. */
  get islands(): readonly Element[] {
    return this.islandRoots;
  }

  buildFromRoot(root: ParentNode): CacheBuildStats {
    const t0 = performance.now();
    this.clear();
    let elementCount = 0;
    for (const element of root.querySelectorAll(FIELD_SELECTOR)) {
      if (this.add(element) !== undefined) elementCount += 1;
    }
    this.islandRoots = collectIslands(root);
    return {
      elementCount,
      fieldCount: this.entriesByField.size,
      durationMs: performance.now() - t0,
    };
  }

  /**
   * Insert or replace a single element's binding. Re-adding refreshes the
   * snapshot in place; an element that is now filtered or unbound is removed.
   */
  add(element: Element): CachedElement | undefined {
    // Resolve before mutating so a throwing filter leaves the old entry intact.
    const entry = this.filter(element) ? this.resolveBinding(element) : undefined;
    const previous = this.entryByElement.get(element);
    this.dependencies = null;
    if (entry === undefined) {
      if (previous !== undefined) this.removeEntry(element, previous);
      return undefined;
    }
    if (previous !== undefined && this.replaceEntry(previous, entry)) {
      this.entryByElement.set(element, entry);
      return entry;
    }
    if (previous !== undefined) this.removeEntry(element, previous);
    this.append(entry);
    this.entryByElement.set(element, entry);
    return entry;
  }

  /** Returns whether a binding was removed. */
  remove(element: Element): boolean {
    const entry = this.entryByElement.get(element);
    if (!entry) return false;
    this.dependencies = null;
    return this.removeEntry(element, entry);
  }

  get(fieldName: string): readonly CachedElement[] | undefined {
    return this.entriesByField.get(fieldName);
  }

  getByElement(element: Element): CachedElement | undefined {
    return this.entryByElement.get(element);
  }

  get fieldCount(): number {
    return this.entriesByField.size;
  }

  get elementCount(): number {
    return this.count;
  }

  entries(): IterableIterator<[string, readonly CachedElement[]]> {
    return this.entriesByField.entries() as IterableIterator<[string, readonly CachedElement[]]>;
  }

  *values(): IterableIterator<CachedElement> {
    for (const bucket of this.entriesByField.values()) yield* bucket;
  }

  has(element: Element): boolean {
    return this.entryByElement.has(element);
  }

  clear(): void {
    this.entriesByField.clear();
    // WeakMap cannot be cleared; a detached element must not observe stale membership.
    this.entryByElement = new WeakMap();
    this.count = 0;
    this.dependencies = null;
    this.islandRoots = [];
  }

  /** Replace in place when the field bucket is unchanged, preserving order. */
  private replaceEntry(previous: CachedElement, next: CachedElement): boolean {
    if (previous.fieldName !== next.fieldName) return false;
    const bucket = this.entriesByField.get(previous.fieldName);
    const index = bucket === undefined ? -1 : bucket.indexOf(previous);
    if (bucket === undefined || index < 0) return false;
    bucket[index] = next;
    return true;
  }

  private removeEntry(element: Element, entry: CachedElement): boolean {
    this.entryByElement.delete(element);
    const bucket = this.entriesByField.get(entry.fieldName);
    const index = bucket === undefined ? -1 : bucket.indexOf(entry);
    if (bucket === undefined || index < 0) return false;
    bucket.splice(index, 1);
    if (bucket.length === 0) this.entriesByField.delete(entry.fieldName);
    this.count -= 1;
    return true;
  }

  private append(entry: CachedElement): void {
    const bucket = this.entriesByField.get(entry.fieldName);
    if (bucket) bucket.push(entry);
    else this.entriesByField.set(entry.fieldName, [entry]);
    this.count += 1;
  }

  private resolveBinding(element: Element): CachedElement | undefined {
    const fieldName = element.getAttribute(FIELD_ATTRIBUTE);
    if (fieldName === null || fieldName.length === 0) return undefined;
    const explicit = element.getAttribute(TYPE_ATTRIBUTE);
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
    const fragmentBoundary = enclosingFragment(element);
    return {
      element,
      fieldName,
      fieldType: resolveFieldType(element),
      explicitFieldType: explicit !== null && isRendererKey(explicit),
      strategyKind: resolveStrategy(element) ?? 'unknown',
      ...(fragmentBoundary !== null ? { fragmentBoundary } : {}),
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
      ...(element.hasAttribute(BOUNDARY_ATTRIBUTE) ? { hidesWhenEmpty: true } : {}),
    };
  }
}

/** Explicit `data-payload-type`, then element heuristics, then `text`. */
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
