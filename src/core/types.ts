/**
 * Core type definitions shared across all runtime primitives.
 *
 * @module @core/types
 */

import type { PayloadFieldType, PayloadFieldSchema } from '@/types/payload-protocol';

/**
 * Field types recognized by the live preview renderer.
 *
 * Extends Payload's field set with `html` and `url` which are not
 * Payload field types per se but useful DOM-binding categories.
 */
export type FieldType = PayloadFieldType | 'html' | 'url' | 'image' | 'structural-array';

/**
 * A DOM element that has been registered as a live preview binding.
 *
 * Stored in the element cache indexed by `fieldName`. Multiple cached
 * entries can share a field name when the same field is rendered in
 * several places (e.g., a title shown in both the header and the
 * page body).
 */
export interface CachedElement {
  /** The bound DOM element. */
  readonly element: Element;
  /** Payload field path, e.g., `title` or `hero.subtitle`. */
  readonly fieldName: string;
  /**
   * Resolved field type, used to dispatch to the right renderer.
   *
   * The cache resolves this from DOM attributes (`data-payload-type`,
   * tag-based heuristics) at build time. When `explicitFieldType` is
   * `false` the lifecycle is allowed to override this with the type
   * learned from the schema once `fieldSchemaJSON` arrives.
   */
  readonly fieldType: FieldType;
  /**
   * `true` when the field type was set by an explicit
   * `data-payload-type` attribute (consumer trumps schema), `false`
   * when it was inferred via tag-based heuristics (schema may
   * override later). Optional so synthetic bindings (tests / programmatic
   * `cache.add()` callers) need not supply it; the cache always
   * populates it for DOM-derived bindings.
   */
  readonly explicitFieldType?: boolean;
  /** Optional sibling-field path bound to the element's `href` attribute. */
  readonly hrefField?: string;
  /** Optional sibling-field path bound to the element's `src` attribute. */
  readonly srcField?: string;
  /** Optional sibling-field path bound to the element's `alt` attribute. */
  readonly altField?: string;
  /** Optional inline template for array/blocks rendering. */
  readonly arrayTemplate?: string;
  /** Optional separator for primitive-array stringification. */
  readonly arraySeparator?: string;
  /** Optional locale code locked onto this element (overrides the global locale). */
  readonly locale?: string;
}

/**
 * Context passed to every field renderer. Provides access to the
 * entire field tree so renderers can resolve sibling fields (e.g.,
 * an `<a>` that pulls `href` from a different field).
 */
export interface RenderContext {
  /** Full field map for the current update — used for sibling lookups. */
  readonly allFields: Record<string, unknown>;
  /** Active locale, or `undefined` when none is established. */
  readonly locale: string | undefined;
  /** Optional schema descriptor for the field, when available. */
  readonly schema: PayloadFieldSchema | undefined;
}

/**
 * Contract that every field renderer implements.
 *
 * Renderers are pure DOM-write functions: they receive the cached
 * binding plus the new value and apply it to the element. They must
 * not throw — failures should be silenced and logged so that one bad
 * field cannot stop an entire update.
 */
export interface FieldRenderer {
  readonly name: FieldType;
  render(target: CachedElement, value: unknown, context: RenderContext): void;
}

/**
 * Predicate the cache uses to filter elements during a build. Allows
 * tests and integrations to scope the cache to a subtree.
 */
export type ElementPredicate = (element: Element) => boolean;
