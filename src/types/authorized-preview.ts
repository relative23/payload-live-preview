/**
 * The authorized preview context's shape and brand.
 *
 * Lives in the leaf `types` domain so that both the producer
 * (`@security/preview-authorization`) and every consumer that must tell a
 * real context from a look-alike — the binding DSL, the draft helpers, the
 * adapters — can import the same private brand without the architecture
 * policy's layering being bent. The verdict is produced in one place; it is
 * recognised everywhere.
 *
 * @module @types/authorized-preview
 */

/**
 * Type-level brand for `AuthorizedPreviewContext`. Declared, never
 * defined: it has no runtime value, so no object literal can carry it and no
 * boolean can be cast into it without a deliberate `as`. The runtime check
 * uses a registry symbol instead — see `isAuthorizedPreviewContext()`.
 */
export declare const AUTHORIZED_PREVIEW_BRAND: unique symbol;

/** Which verification produced a context. */
export type PreviewAuthorizationStrategyName = 'payload-session' | 'signed-token' | 'verifier';

/** What a context is bound to. Every field is optional because every strategy binds differently. */
export interface AuthorizedPreviewScope {
  /** The site origin the credential was issued for. */
  readonly audience?: string;
  /** The request pathname the credential is valid for. */
  readonly path?: string;
  /** The locale the credential is valid for. */
  readonly locale?: string;
}

/**
 * The verdict of a successful `authorizePreviewRequest()`.
 *
 * Frozen, branded, and produced only by that function. Carry it, do not
 * rebuild it: `createPreviewBindings`, the draft helpers and the adapters
 * accept it as their `authorization`, and `isAuthorizedPreviewContext()`
 * is how any of them tells a real one from a look-alike.
 */
export interface AuthorizedPreviewContext {
  readonly [AUTHORIZED_PREVIEW_BRAND]: true;
  readonly strategy: PreviewAuthorizationStrategyName;
  /** The user id, token subject, or whatever the verifier named. */
  readonly subject: string | undefined;
  /** When the verification happened, Unix milliseconds. */
  readonly authorizedAt: number;
  /** When the credential stops being valid, Unix milliseconds, or `undefined` when the strategy does not know. */
  readonly expiresAt: number | undefined;
  readonly scope: AuthorizedPreviewScope;
  /**
   * The minimal request material a draft read must forward to Payload —
   * exactly the one verified cookie for the session strategy; nothing for the
   * token strategy; whatever the verifier chose to hand over. Never the
   * whole incoming `Cookie` header.
   */
  readonly payloadHeaders: Readonly<Record<string, string>>;
}

/**
 * A registry symbol, not a private one, on purpose: the root entry and each
 * adapter entry are separate bundles, and each would otherwise evaluate its
 * own `Symbol()` — a context produced by `authorizePreviewRequest` (root)
 * would then be refused by `livePreviewHandle` (adapter) in the packaged
 * package while every unit test, which runs one module graph, passed.
 * `Symbol.for` is identical across bundles and across duplicate package
 * copies in one process. The brand catches accidental look-alikes —
 * literals, copies, JSON round trips — which is all it ever promised; a
 * deliberate forger could cast past a private symbol too.
 */
export const AUTHORIZED_PREVIEW_BRAND_KEY = 'payload-live-preview.authorized-preview-context';
const BRAND = Symbol.for(AUTHORIZED_PREVIEW_BRAND_KEY);

/**
 * Whether `value` was produced by `authorizePreviewRequest()`. A structural
 * look-alike — `{ authorized: true }`, a copied object, a JSON round trip —
 * is not.
 */
export function isAuthorizedPreviewContext(value: unknown): value is AuthorizedPreviewContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[BRAND] === true &&
    Object.isFrozen(value)
  );
}

/**
 * Produce a context. Internal to the package: the only caller is the
 * authorization module, and this is the one cast in the code base — the
 * declared brand has no runtime value, the private symbol stands in for it.
 */
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
