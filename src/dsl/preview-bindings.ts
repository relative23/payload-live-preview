/**
 * Binding helpers gated on one authorization verdict per request: the
 * attributes publish the content model, so an unauthorized response carries
 * none and a binding is suppressed whole, never in part. See ADR 0006.
 */

import {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
} from '@/types/authorized-preview';
import { bind, bindByPath, type BindOptions, type FieldBindingAttributes } from './bind';
import type { FieldName } from './paths';

export interface OwnerBindingAttributes {
  readonly 'data-payload-owner': string;
}

/** No attributes at all: an unauthorized response is byte-identical to one that never knew about live preview. */
export type SuppressedBinding = Readonly<Record<string, never>>;

const SUPPRESSED: SuppressedBinding = Object.freeze({});

export interface PreviewBindingsCommonOptions {
  /** Document this subtree belongs to, emitted as `data-payload-owner`; needed with `scopeBindingsByOwner`. */
  readonly owner?: string;
}

/** The verdict from `authorizePreviewRequest()`, or `null` for a public response. Only a branded context authorizes emission. */
export interface PreviewBindingsOptions extends PreviewBindingsCommonOptions {
  readonly authorization: AuthorizedPreviewContext | null;
}

/** Request-scoped binding helpers carrying one authorization decision. */
export interface PreviewBindings {
  readonly authorized: boolean;
  /** Typed field binding, or nothing while unauthorized. */
  bind: <T = Record<string, unknown>>(
    field: FieldName<T>,
    options?: BindOptions,
  ) => FieldBindingAttributes | SuppressedBinding;
  /** Rename-safe field binding, or nothing while unauthorized. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  bindByPath: <T = Record<string, unknown>>(
    picker: (data: T) => unknown,
    options?: BindOptions,
  ) => FieldBindingAttributes | SuppressedBinding;
  /** Owner marker for this subtree, or nothing while unauthorized or without an owner. */
  owner: () => OwnerBindingAttributes | SuppressedBinding;
}

/** Request-scoped `bind`, `bindByPath` and `owner`, all suppressed unless `authorization` is a real context. */
export function createPreviewBindings(options: PreviewBindingsOptions): PreviewBindings {
  // A copied or hand-written context is a public response.
  const authorized = isAuthorizedPreviewContext(options.authorization);
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
