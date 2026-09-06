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

/** The attributes marking a server-rendered boundary (ADR 0011, docs/hybrid.md). */
export interface FragmentBoundaryAttributes {
  readonly 'data-payload-fragment': string;
  readonly 'data-payload-fragment-key'?: string;
  readonly 'data-payload-depends'?: string;
}

export interface FragmentBoundaryOptions {
  /** Distinguishes boundaries when one registry id renders several on a page. */
  readonly key?: string;
  /** The fields that re-render the boundary. Without it, every update does. */
  readonly dependsOn?: readonly string[];
}

/**
 * Stricter than the endpoint's own check, which accepts either case: an id is
 * written here, and one that only differs in case from the registry key is a
 * boundary that silently never renders.
 */
const REGISTRY_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const MAX_KEY_LENGTH = 128;

/** No attributes at all: an unauthorized response is byte-identical to one that never knew about live preview. */
export type SuppressedBinding = Readonly<Record<string, never>>;

const SUPPRESSED: SuppressedBinding = Object.freeze({});

/** The verdict from `authorizePreviewRequest()`, or `null` for a public response. Only a branded context authorizes emission. */
export interface PreviewBindingsOptions {
  readonly authorization: AuthorizedPreviewContext | null;
  /** Document this subtree belongs to, emitted as `data-payload-owner`; needed with `scopeBindingsByOwner`. */
  readonly owner?: string;
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
  // `T` names the caller's document type; see bindByPath in ./bind.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  bindByPath: <T = Record<string, unknown>>(
    picker: (data: T) => unknown,
    options?: BindOptions,
  ) => FieldBindingAttributes | SuppressedBinding;
  /** Owner marker for this subtree, or nothing while unauthorized or without an owner. */
  owner: () => OwnerBindingAttributes | SuppressedBinding;
  /**
   * A server-rendered boundary, or nothing while unauthorized — the id and the
   * fields it depends on describe the content model as much as a binding does.
   * The registry behind `id` is the endpoint's (docs/hybrid.md).
   */
  boundary: (
    id: string,
    options?: FragmentBoundaryOptions,
  ) => FragmentBoundaryAttributes | SuppressedBinding;
}

/** Built whether or not the response is authorized, so a bad id fails everywhere, not only in preview. */
function boundaryAttributes(
  id: string,
  options: FragmentBoundaryOptions,
): FragmentBoundaryAttributes {
  if (!REGISTRY_ID.test(id)) {
    throw new RangeError(
      `createPreviewBindings().boundary(): "${id}" is not a registry id — lowercase, starting ` +
        'with a letter, then letters, digits or hyphens (max 64). The runtime would post it and ' +
        'the endpoint would refuse it.',
    );
  }
  const key = options.key;
  if (key !== undefined && (key.length === 0 || key.length > MAX_KEY_LENGTH)) {
    throw new RangeError(
      `createPreviewBindings().boundary(): the key for "${id}" must be 1 to ${String(MAX_KEY_LENGTH)} characters.`,
    );
  }
  const dependsOn = options.dependsOn ?? [];
  return {
    'data-payload-fragment': id,
    ...(key !== undefined ? { 'data-payload-fragment-key': key } : {}),
    ...(dependsOn.length > 0 ? { 'data-payload-depends': dependsOn.join(',') } : {}),
  };
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
    // `T` names the caller's document type; see bindByPath in ./bind.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    bindByPath: <T = Record<string, unknown>>(
      picker: (data: T) => unknown,
      bindOptions?: BindOptions,
    ): FieldBindingAttributes | SuppressedBinding =>
      authorized ? bindByPath<T>(picker, bindOptions) : SUPPRESSED,
    owner: (): OwnerBindingAttributes | SuppressedBinding =>
      authorized && owner !== undefined ? { 'data-payload-owner': owner } : SUPPRESSED,
    boundary: (
      id: string,
      boundaryOptions: FragmentBoundaryOptions = {},
    ): FragmentBoundaryAttributes | SuppressedBinding => {
      const attributes = boundaryAttributes(id, boundaryOptions);
      return authorized ? attributes : SUPPRESSED;
    },
  });
}
