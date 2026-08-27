/**
 * Trusted Types support (roadmap 1.3.0).
 *
 * Under a `Content-Security-Policy: require-trusted-types-for 'script'`
 * every `innerHTML` assignment must receive a `TrustedHTML`, or the browser
 * throws. This package has one policy, named `payload-live-preview`, and
 * every HTML sink in the runtime — the sanitizer's own parse, the rich-text,
 * html, array, upload, text and structural renderers — routes its string
 * through it. The policy's `createHTML` returns its input unchanged: the
 * sanitizer is the policy, in the sense the specification intends, and what
 * reaches a sink has already been sanitized or escaped.
 *
 * A site that enforces Trusted Types lists the name in its
 * `trusted-types` directive, or hands its own policy to
 * `setTrustedTypesPolicy()`. Without enforcement — or in a browser without
 * the API — strings pass through untouched.
 *
 * @module @security/trusted-types
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
 * Use `policy` for every HTML sink, `null` to disable Trusted Types wrapping
 * (strings are assigned as they are), or `undefined` to return to the
 * default: the auto-created `payload-live-preview` policy where the API exists.
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
    // The CSP's `trusted-types` directive does not list this name. Nothing to
    // do here: the sink assignment will surface the enforcement error, which
    // is the browser's honest message about the site's policy.
    autoPolicy = null;
  }
  return autoPolicy;
}

/**
 * `html` as the value to assign to an HTML sink: a `TrustedHTML` when a
 * policy is available, the string itself otherwise. Typed as `string`
 * because `innerHTML` accepts both and the DOM types predate the API.
 */
export function trustedHtml(html: string): string {
  const policy = resolvePolicy();
  if (policy === null) return html;
  return policy.createHTML(html) as string;
}

/** Test hook: forget the auto-created policy so the next sink resolves again. */
export function __resetTrustedTypesForTests(): void {
  policyOverride = undefined;
  autoPolicy = undefined;
}
