/**
 * The authorized preview context's shape and brand, in the leaf `types` domain
 * so producer and consumers recognise the same context. See ADR 0006.
 */

/**
 * The brand key, in the type and on the object.
 *
 * This was a `unique symbol` until 2026-08-30. A `unique symbol` is nominal per
 * *declaration*, and the published entries each carry their own declaration
 * file — so `AuthorizedPreviewContext` from the root barrel was a different
 * type from the one in `./server` or in an adapter, and the documented flow
 * (authorize once, hand the context to the adapter hook and to the draft read)
 * did not type-check in any combination a consumer can write.
 *
 * That is the same trap the runtime brand below already avoids by using
 * `Symbol.for` rather than `Symbol()`; the lesson simply had not reached the
 * type. A shared string literal is identical in every bundle for the same
 * reason a registry symbol is.
 *
 * It is not what makes a context trustworthy. `isAuthorizedPreviewContext`
 * decides that, on the registry symbol and on `Object.isFrozen`, and every
 * consumption point calls it — the adapter policy, the draft read and the
 * binding emitter. Writing this key by hand buys nothing.
 */
export const AUTHORIZED_PREVIEW_BRAND_KEY = 'payload-live-preview.authorized-preview-context';

export type PreviewAuthorizationStrategyName = 'payload-session' | 'signed-token' | 'verifier';

/** What a context is bound to; every field is optional because every strategy binds differently. */
export interface AuthorizedPreviewScope {
  /** The site origin the credential was issued for. */
  readonly audience?: string;
  /** The request pathname the credential is valid for. */
  readonly path?: string;
  readonly locale?: string;
}

/** The verdict of a successful `authorizePreviewRequest()`: frozen, branded, produced only there. Carry it, do not rebuild it. */
export interface AuthorizedPreviewContext {
  readonly [AUTHORIZED_PREVIEW_BRAND_KEY]: true;
  readonly strategy: PreviewAuthorizationStrategyName;
  /** The user id, token subject, or whatever the verifier named. */
  readonly subject: string | undefined;
  /** Unix milliseconds. */
  readonly authorizedAt: number;
  /** Unix milliseconds, or `undefined` when the strategy does not know. */
  readonly expiresAt: number | undefined;
  readonly scope: AuthorizedPreviewScope;
  /** The minimal request material a draft read forwards to Payload — one verified cookie, never the whole `Cookie` header. */
  readonly payloadHeaders: Readonly<Record<string, string>>;
}

// A registry symbol: entries are separate bundles, and a per-bundle `Symbol()`
// would refuse the other's contexts in the package while unit tests passed.
const BRAND = Symbol.for(AUTHORIZED_PREVIEW_BRAND_KEY);

/** Whether `value` was produced by `authorizePreviewRequest()`; a copy or JSON round trip is not. */
export function isAuthorizedPreviewContext(value: unknown): value is AuthorizedPreviewContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[BRAND] === true &&
    Object.isFrozen(value)
  );
}

/** Internal: the one place a context is made. */
export function createAuthorizedPreviewContext(
  fields: Omit<AuthorizedPreviewContext, typeof AUTHORIZED_PREVIEW_BRAND_KEY>,
): AuthorizedPreviewContext {
  const context = Object.freeze({
    ...fields,
    scope: Object.freeze({ ...fields.scope }),
    payloadHeaders: Object.freeze({ ...fields.payloadHeaders }),
    [BRAND]: true,
    [AUTHORIZED_PREVIEW_BRAND_KEY]: true,
  });
  // No cast: the frozen object carries the brand key the interface declares.
  return context;
}
