/**
 * The authorized preview context's shape and brand, in the leaf `types` domain
 * so producer and consumers recognise the same context. See ADR 0006.
 */

/**
 * The mark in the type. It names no property: no object has this key, and
 * nothing exports it, so a context cannot be written as a literal. Until 3.0
 * the mark was a string key every entry's declaration file repeated, because a
 * `unique symbol` is nominal per declaration and each entry had its own. Since
 * the entries share their declarations (ADR 0007, row 43), one declaration is
 * what all of them see.
 */
declare const AUTHORIZED: unique symbol;

export type PreviewAuthorizationStrategyName = 'payload-session' | 'signed-token' | 'verifier';

/** One server-authorized Payload document, not a query selected by the browser. */
export type AuthorizedPreviewDocument =
  | { readonly kind: 'collection'; readonly slug: string; readonly id: string | number }
  | { readonly kind: 'global'; readonly slug: string };

/** Opt-in data capability, enforced by the fragment endpoint and `definePreview`. */
export interface AuthorizedPreviewPayloadScope {
  /** Payload base URL, distinct from the preview site's audience. */
  readonly serverURL: string;
  /** REST prefix, default `/api`. */
  readonly apiRoute?: string;
  readonly document: AuthorizedPreviewDocument;
  /** Maximum requested population depth, not a field-level ACL. */
  readonly maxDepth: number;
}

/** What a context is bound to; every field is optional because every strategy binds differently. */
export interface AuthorizedPreviewScope {
  /** The site origin the credential was issued for. */
  readonly audience?: string;
  /** The request pathname the credential is valid for. */
  readonly path?: string;
  readonly locale?: string;
  /** Requires a finite context expiry. Unscoped contexts keep their existing behavior. */
  readonly payload?: AuthorizedPreviewPayloadScope;
}

/** The verdict of a successful `authorizePreviewRequest()`: frozen, branded, produced only there. Carry it, do not rebuild it. */
export interface AuthorizedPreviewContext {
  readonly [AUTHORIZED]: true;
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

/**
 * The contexts this module made. Until 3.0 the mark was a registry symbol on
 * the object, because every entry carried its own copy of this module and a
 * mark one copy kept to itself would have refused the other's contexts. Anybody
 * can write a registry symbol. With one module graph there is one copy, and it
 * keeps the list (ADR 0007, row 44).
 */
const MINTED = new WeakSet();

/**
 * Whether `value` is a context `authorizePreviewRequest()` made. A copy is not, frozen or not,
 * and neither is a JSON round trip or an object built by hand (ADR 0006).
 */
export function isAuthorizedPreviewContext(value: unknown): value is AuthorizedPreviewContext {
  // `has` answers false for what is not an object, so nothing is asked before it.
  return MINTED.has(value as WeakKey);
}

/** Internal: the one place a context is made. */
export function createAuthorizedPreviewContext(
  fields: Omit<AuthorizedPreviewContext, typeof AUTHORIZED>,
): AuthorizedPreviewContext {
  const context = {
    ...fields,
    scope: Object.freeze({
      ...fields.scope,
      ...(fields.scope.payload === undefined
        ? {}
        : {
            payload: Object.freeze({
              ...fields.scope.payload,
              document: Object.freeze({ ...fields.scope.payload.document }),
            }),
          }),
    }),
    payloadHeaders: Object.freeze({ ...fields.payloadHeaders }),
  };
  // The cookie is HttpOnly in the browser. Not enumerable, so `JSON.stringify(locals)`, a log,
  // a spread or a framework serializer leaves it out; a draft read still reads it by name.
  Object.defineProperty(context, 'payloadHeaders', { enumerable: false });
  Object.freeze(context);
  MINTED.add(context);
  // The mark is in the type alone: the list above is what says the object was made here.
  return context as typeof context & { readonly [AUTHORIZED]: true };
}
