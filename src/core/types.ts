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
 * A project-defined renderer key: namespaced, so it can never collide with a
 * built-in field type or be produced by a typo of one. `data-payload-type="acme:price"`
 * selects the renderer registered under that exact name; an unknown key
 * without a namespace still falls back to the tag heuristics.
 */
export type CustomRendererKey = `${string}:${string}`;

/** What a renderer may be registered under and an element may ask for. */
export type RendererKey = FieldType | CustomRendererKey;

/**
 * A project-provided rich-text renderer, shared by SSR and preview so one
 * Lexical document produces the same markup on both sides. The runtime passes
 * its output through the sanitizer; render with the same `sanitizeHtml()` on
 * the server for byte equality.
 */
export type RichTextRenderer = (
  value: unknown,
  context: {
    readonly fieldName: string;
    readonly element: Element;
    readonly locale: string | undefined;
  },
) => string;

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
  readonly fieldType: RendererKey;
  /**
   * `true` when the field type was set by an explicit
   * `data-payload-type` attribute (consumer trumps schema), `false`
   * when it was inferred via tag-based heuristics (schema may
   * override later). Optional so synthetic bindings (tests / programmatic
   * `cache.add()` callers) need not supply it; the cache always
   * populates it for DOM-derived bindings.
   */
  readonly explicitFieldType?: boolean;
  /** Fields this binding depends on (`data-payload-depends`); a change in any re-applies it under `skipUnchanged`. */
  readonly dependsOn?: readonly string[];
  /** `data-payload-strategy`; only `patch` is applied in 1.x, anything else is left for the fragment strategy. */
  readonly strategy?: string;
  /** `data-payload-boundary`: an anchor that hides itself while its field is empty. */
  readonly boundary?: boolean;
  /**
   * Optional target attribute: the value is written to this attribute
   * instead of the element's content (from `data-payload-attribute`,
   * or `bind(field, { attribute })`). Writes are policed — event
   * handlers, `style`, and unsafe URLs are refused.
   */
  readonly targetAttribute?: string;
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
  /**
   * Optional document this binding belongs to, resolved from the nearest
   * `data-payload-owner` ancestor (the element itself included).
   *
   * Only consulted while owner scoping is enabled. Without it a field name is
   * the sole identity, so every document rendered on the page competes for the
   * same name.
   */
  readonly owner?: string;
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
  /** The project's rich-text renderer, when the client was configured with one. */
  readonly renderRichText?: RichTextRenderer;
}

/**
 * Contract that every field renderer implements.
 *
 * Renderers are pure DOM-write functions: they receive the cached
 * binding plus the new value and apply it to the element. They must
 * not throw — failures should be silenced and logged so that one bad
 * field cannot stop an entire update. The public renderer result remains
 * `void` for 1.x compatibility. Built-in renderers may use an internal exact
 * `false` sentinel when they deliberately perform no DOM write; callers must
 * not rely on that implementation detail.
 */
export interface FieldRenderer {
  readonly name: RendererKey;
  render(target: CachedElement, value: unknown, context: RenderContext): void;
}

/**
 * Predicate the cache uses to filter elements during a build. Allows
 * tests and integrations to scope the cache to a subtree.
 */
export type ElementPredicate = (element: Element) => boolean;
