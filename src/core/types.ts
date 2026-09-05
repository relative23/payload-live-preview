/** Types shared by the runtime primitives. */

import type { PayloadFieldType, PayloadFieldSchema } from '@/types/payload-protocol';
import type { SanitizerPolicyMode } from '@security/sanitizer';
import type { UpdateSource } from './strategies';

/** Payload's field set plus the DOM-binding categories `html`, `url`, `image` and `structural-array`. */
export type FieldType = PayloadFieldType | 'html' | 'url' | 'image' | 'structural-array';

/** A namespaced project renderer key, so a typo of a built-in type can never become one. */
export type CustomRendererKey = `${string}:${string}`;

/** What a renderer may be registered under and an element may ask for. */
export type RendererKey = FieldType | CustomRendererKey;

/**
 * A project rich-text renderer, shared by SSR and preview. Its output goes
 * through the sanitizer; call the same `sanitizeHtml()` server-side for byte equality.
 */
export type RichTextRenderer = (
  value: unknown,
  context: {
    readonly fieldName: string;
    readonly element: Element;
    readonly locale: string | undefined;
  },
) => string;

/** One registered binding. Several may share a field name when it renders in several places. */
export interface CachedElement {
  /** The bound DOM element. */
  readonly element: Element;
  /** Payload field path, e.g., `title` or `hero.subtitle`. */
  readonly fieldName: string;
  /** Resolved from attributes and tag heuristics; the schema may override it unless explicit. */
  readonly fieldType: RendererKey;
  /** Whether `data-payload-type` set the type, in which case the schema must not override it. */
  readonly explicitFieldType?: boolean;
  /** Fields this binding depends on (`data-payload-depends`); a change in any re-applies it under `skipUnchanged`. */
  readonly dependsOn?: readonly string[];
  /** Raw `data-payload-strategy` value. */
  readonly strategy?: string;
  /** How the runtime brings this binding up to date; `'unknown'` for an unrecognised strategy. Resolved by the cache. */
  readonly strategyKind?: UpdateSource | 'unknown';
  /** Nearest enclosing `data-payload-fragment` boundary. Resolved by the cache. */
  readonly fragmentBoundary?: Element;
  /** `data-payload-boundary`: an anchor that hides itself while its field is empty. */
  readonly hidesWhenEmpty?: boolean;
  /** Write the value into this attribute instead of the content; policed writes. */
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
  /** The document this binding belongs to, from the nearest `data-payload-owner`. */
  readonly owner?: string;
}

/** What a renderer is given; `allFields` lets it resolve a sibling field. */
export interface RenderContext {
  /** Full field map for the current update — used for sibling lookups. */
  readonly allFields: Record<string, unknown>;
  /** Active locale, or `undefined` when none is established. */
  readonly locale: string | undefined;
  /** Optional schema descriptor for the field, when available. */
  readonly schema: PayloadFieldSchema | undefined;
  /** The project's rich-text renderer, when the client was configured with one. */
  readonly renderRichText?: RichTextRenderer;
  /**
   * This instance's sanitizer policy, for every HTML write the renderer makes.
   * Absent, the process default set by `setSanitizerPolicy()` applies.
   */
  readonly sanitizerPolicy?: SanitizerPolicyMode;
}

/**
 * A renderer writes one value into its element. It must not throw: one bad
 * field may not stop an update. The result stays `void` — the internal
 * no-write sentinel is not part of the contract.
 */
export interface FieldRenderer {
  readonly name: RendererKey;
  render(target: CachedElement, value: unknown, context: RenderContext): void;
}

/** Restricts which elements the cache accepts. */
export type ElementPredicate = (element: Element) => boolean;
