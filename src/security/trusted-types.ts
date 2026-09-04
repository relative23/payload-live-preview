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

export const TRUSTED_TYPES_POLICY_NAME = 'payload-live-preview';

let policyOverride: TrustedHtmlPolicyLike | null | undefined;
let autoPolicy: TrustedHtmlPolicyLike | null | undefined;

/**
 * Use `policy` for every sink, `null` to assign plain strings, `undefined` to
 * return to the auto-created package policy.
 */
export function setTrustedTypesPolicy(policy: TrustedHtmlPolicyLike | null | undefined): void {
  policyOverride = policy;
}

function factory(): TrustedTypesFactoryLike | undefined {
  const candidate = (globalThis as { trustedTypes?: unknown }).trustedTypes;
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const create = (candidate as { createPolicy?: unknown }).createPolicy;
  return typeof create === 'function' ? (candidate as TrustedTypesFactoryLike) : undefined;
}

function resolvePolicy(): TrustedHtmlPolicyLike | null {
  if (policyOverride !== undefined) return policyOverride;
  if (autoPolicy !== undefined) return autoPolicy;
  const api = factory();
  if (api === undefined) {
    autoPolicy = null;
    return null;
  }
  try {
    autoPolicy = api.createPolicy(TRUSTED_TYPES_POLICY_NAME, { createHTML: (input) => input });
  } catch {
    // The site's `trusted-types` directive does not list this name; the
    // sink assignment will surface the enforcement error.
    autoPolicy = null;
  }
  return autoPolicy;
}

/** `html` as a `TrustedHTML` when a policy exists, else the string. Typed `string` for `innerHTML`. */
export function trustedHtml(html: string): string {
  const policy = resolvePolicy();
  if (policy === null) return html;
  return policy.createHTML(html) as string;
}

/** Test hook: forget the auto-created policy. */
export function __resetTrustedTypesForTests(): void {
  policyOverride = undefined;
  autoPolicy = undefined;
}
