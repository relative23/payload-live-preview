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
   * Document this subtree belongs to, emitted as `data-payload-owner` by
   * {@link PreviewBindings.owner}. Required only when the page previews more
   * than one document and the runtime runs with `scopeBindingsByOwner`.
   */
  readonly owner?: string;
}

/**
 * The authorization verdict as a context from `authorizePreviewRequest()`, or
 * `null` for a public response. 2.0 removed the `authorized: boolean` form
 * (ADR 0007, entry 7): only a branded context authorizes emission, so a
 * client-controlled intent signal can never be mistaken for a verdict.
 */
export interface PreviewBindingsOptions extends PreviewBindingsCommonOptions {
  readonly authorization: AuthorizedPreviewContext | null;
}

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
 * A context is trusted only when the brand check says it is one — a copied or
 * hand-written object is a public response.
 */
function resolveVerdict(options: PreviewBindingsOptions): boolean {
  return isAuthorizedPreviewContext(options.authorization);
}
