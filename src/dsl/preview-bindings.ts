/**
 * Authorization-gated binding emission.
 *
 * Binding attributes are not neutral markup. `data-payload-field` names a CMS
 * field, and `data-payload-owner` names a global, a collection and often a
 * document id. Emitted unconditionally they publish the shape of the content
 * model — and the identity of documents — to every anonymous visitor and
 * crawler of the page.
 *
 * The gate belongs to the application, not to this package: it is the same
 * decision that already controls draft reads and cache policy. What this
 * module provides is a place to apply that decision **once per request** so no
 * individual call site can forget it, and an emission unit that cannot be
 * partially suppressed.
 *
 * That second property matters more than it looks. A binding is not one
 * attribute: a field travels with its type, its locale, its rich-text marker
 * and its owner. Gating only the field name leaves the companions behind,
 * which discloses the taxonomy anyway and leaves the runtime looking at a
 * binding whose field is gone.
 *
 * @module @dsl/preview-bindings
 */

import {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
} from '@/types/authorized-preview';
import { bind, bindByPath, type BindOptions, type FieldBindingAttributes } from './bind';
import type { FieldName } from './paths';

/** Owner marker naming the document a subtree belongs to. */
export interface OwnerBindingAttributes {
  readonly 'data-payload-owner': string;
}

/**
 * The complete absence of binding attributes.
 *
 * Spreading this into markup contributes nothing, which is the point: an
 * unauthorized response must be byte-identical to one that never knew about
 * live preview.
 */
export type SuppressedBinding = Readonly<Record<string, never>>;

const SUPPRESSED: SuppressedBinding = Object.freeze({});

export interface PreviewBindingsCommonOptions {
  /**
   * Refuse the boolean form: under `strict` only a context produced by
   * `authorizePreviewRequest()` authorizes emission. ADR 0007, entry 7.
   */
  readonly strict?: boolean;
  /**
   * Document this subtree belongs to, emitted as `data-payload-owner` by
   * {@link PreviewBindings.owner}. Required only when the page previews more
   * than one document and the runtime runs with `scopeBindingsByOwner`.
   */
  readonly owner?: string;
}

/** The verdict as a context from `authorizePreviewRequest()`, or `null` for a public response. */
export interface PreviewBindingsContextOptions extends PreviewBindingsCommonOptions {
  readonly authorization: AuthorizedPreviewContext | null;
  readonly authorized?: undefined;
}

/**
 * The verdict as a boolean the application verified elsewhere. Kept through
 * 1.x; refused under `strict`. Never derive it from `?preview=true`, an
 * iframe destination or a referer — those are client-controlled intent
 * signals. Use the same verified result that decides whether drafts may be
 * read.
 */
export interface PreviewBindingsBooleanOptions extends PreviewBindingsCommonOptions {
  readonly authorized: boolean;
  readonly authorization?: undefined;
}

export type PreviewBindingsOptions = PreviewBindingsContextOptions | PreviewBindingsBooleanOptions;

/** Request-scoped binding helpers that carry one authorization decision. */
export interface PreviewBindings {
  /** The verdict these helpers were built with. */
  readonly authorized: boolean;
  /** Typed field binding, or nothing at all while unauthorized. */
  bind: <T = Record<string, unknown>>(
    field: FieldName<T>,
    options?: BindOptions,
  ) => FieldBindingAttributes | SuppressedBinding;
  /** Rename-safe field binding, or nothing at all while unauthorized. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  bindByPath: <T = Record<string, unknown>>(
    picker: (data: T) => unknown,
    options?: BindOptions,
  ) => FieldBindingAttributes | SuppressedBinding;
  /**
   * Owner marker for the element that owns this subtree, or nothing at all
   * while unauthorized or when no owner was configured.
   */
  owner: () => OwnerBindingAttributes | SuppressedBinding;
}

/**
 * Build request-scoped binding helpers around one authorization decision.
 *
 * ```ts
 * const preview = createPreviewBindings({
 *   authorized: authorization !== null,
 *   owner: `global:${slug}`,
 * });
 * ```
 * ```astro
 * <section {...preview.owner()}>
 *   <h1 {...preview.bind<Homepage>('heroTitle')}>{data.heroTitle}</h1>
 * </section>
 * ```
 *
 * While unauthorized every helper returns an empty attribute set, so the
 * public response carries no `data-payload-*` at all.
 */
export function createPreviewBindings(options: PreviewBindingsOptions): PreviewBindings {
  const authorized = resolveVerdict(options);
  const owner = options.owner !== undefined && options.owner.length > 0 ? options.owner : undefined;

  return Object.freeze({
    authorized,
    bind: <T = Record<string, unknown>>(
      field: FieldName<T>,
      bindOptions?: BindOptions,
    ): FieldBindingAttributes | SuppressedBinding =>
      authorized ? bind<T>(field, bindOptions) : SUPPRESSED,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    bindByPath: <T = Record<string, unknown>>(
      picker: (data: T) => unknown,
      bindOptions?: BindOptions,
    ): FieldBindingAttributes | SuppressedBinding =>
      authorized ? bindByPath<T>(picker, bindOptions) : SUPPRESSED,
    owner: (): OwnerBindingAttributes | SuppressedBinding =>
      authorized && owner !== undefined ? { 'data-payload-owner': owner } : SUPPRESSED,
  });
}

/**
 * One boolean from either option form. A context is trusted only when the
 * brand check says it is one — a copied or hand-written object is a public
 * response. The boolean form is refused under `strict`.
 */
function resolveVerdict(options: PreviewBindingsOptions): boolean {
  if (options.authorization !== undefined) return isAuthorizedPreviewContext(options.authorization);
  if (options.strict === true) {
    throw new Error(
      'payload-live-preview: strict preview bindings need `authorization` from ' +
        'authorizePreviewRequest(), not an `authorized` boolean (ADR 0007, entry 7).',
    );
  }
  return options.authorized;
}
