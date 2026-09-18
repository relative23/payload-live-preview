/**
 * Trusted Types: every HTML sink routes through one policy, `payload-live-preview`,
 * whose `createHTML` is the identity — what reaches a sink is already sanitized
 * or escaped. Without the API, strings pass through untouched.
 */

/** The subset of the Trusted Types API this module needs. */
export interface TrustedHtmlPolicyLike {
  createHTML(input: string): unknown;
}

interface TrustedTypesFactoryLike {
  createPolicy(
    name: string,
    rules: { createHTML: (input: string) => string },
  ): TrustedHtmlPolicyLike;
}

/** @internal */
export const TRUSTED_TYPES_POLICY_NAME = 'payload-live-preview';

// Held on the realm, not in this module: every package entry is its own bundle
// with its own copy of this file, and a page's `trusted-types` directive allows
// the name once. A second copy that asked for it again would be refused and fall
// back to strings; instead every copy shares the one policy, and a policy set
// through one entry reaches the others.
const SLOT: unique symbol = Symbol.for('payload-live-preview.trusted-types');
interface SharedPolicies {
  override?: TrustedHtmlPolicyLike | null | undefined;
  auto?: TrustedHtmlPolicyLike | null | undefined;
}
interface Realm {
  [SLOT]?: SharedPolicies | undefined;
}
function shared(): SharedPolicies {
  const realm = globalThis as Realm;
  const existing = realm[SLOT];
  if (existing !== undefined) return existing;
  const created: SharedPolicies = {};
  realm[SLOT] = created;
  return created;
}

/**
 * Use `policy` for every sink, `null` to assign plain strings, `undefined` to
 * return to the auto-created package policy.
 */
export function setTrustedTypesPolicy(policy: TrustedHtmlPolicyLike | null | undefined): void {
  shared().override = policy;
}

function factory(): TrustedTypesFactoryLike | undefined {
  const candidate = (globalThis as { trustedTypes?: unknown }).trustedTypes;
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const create = (candidate as { createPolicy?: unknown }).createPolicy;
  return typeof create === 'function' ? (candidate as TrustedTypesFactoryLike) : undefined;
}

function resolvePolicy(): TrustedHtmlPolicyLike | null {
  const policies = shared();
  if (policies.override !== undefined) return policies.override;
  if (policies.auto !== undefined) return policies.auto;
  const api = factory();
  try {
    policies.auto =
      api === undefined
        ? null
        : api.createPolicy(TRUSTED_TYPES_POLICY_NAME, { createHTML: (input) => input });
  } catch {
    // The site's `trusted-types` directive does not list this name; the
    // sink assignment will surface the enforcement error.
    policies.auto = null;
  }
  return policies.auto;
}

/** `html` as a `TrustedHTML` when a policy exists, else the string. Typed `string` for `innerHTML`. @internal */
export function trustedHtml(html: string): string {
  const policy = resolvePolicy();
  if (policy === null) return html;
  return policy.createHTML(html) as string;
}

/** Test hook: forget the auto-created policy. */
export function __resetTrustedTypesForTests(): void {
  (globalThis as Realm)[SLOT] = undefined;
}
