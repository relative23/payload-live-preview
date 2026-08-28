/**
 * The authorized preview context's shape and brand, in the leaf `types` domain
 * so producer and consumers recognise the same context. See ADR 0006.
 */

/** Declared, never defined: no literal can carry it and no boolean can be cast into it. */
export declare const AUTHORIZED_PREVIEW_BRAND: unique symbol;

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
  readonly [AUTHORIZED_PREVIEW_BRAND]: true;
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
export const AUTHORIZED_PREVIEW_BRAND_KEY = 'payload-live-preview.authorized-preview-context';
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
  fields: Omit<AuthorizedPreviewContext, typeof AUTHORIZED_PREVIEW_BRAND>,
): AuthorizedPreviewContext {
  const context = Object.freeze({
    ...fields,
    scope: Object.freeze({ ...fields.scope }),
    payloadHeaders: Object.freeze({ ...fields.payloadHeaders }),
    [BRAND]: true,
  });
  return context as unknown as AuthorizedPreviewContext;
}
