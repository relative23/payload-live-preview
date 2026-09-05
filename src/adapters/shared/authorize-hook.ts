/**
 * Running an `authorizePreview` hook. What the hook may resolve to is
 * normalised here once, so the page policy and the fragment endpoint read the
 * same verdict from the same callback. See ADR 0006.
 */

import {
  isPreviewConfigurationError,
  refused,
  type PreviewAuthorization,
} from '@security/preview-verdict';
// From the leaf `types` domain on purpose: the security module would pull the
// HMAC and session code into every adapter bundle for a ten-line brand check.
import { isAuthorizedPreviewContext } from '@/types/authorized-preview';
import type { PreviewAuthorizationHookResult } from './options';

/** A bound hook: the adapter option with the request already applied. */
export type BoundAuthorizeHook = () =>
  PreviewAuthorizationHookResult | Promise<PreviewAuthorizationHookResult>;

/**
 * The hook's result as a verdict. Only a context `authorizePreviewRequest()`
 * produced authorizes, bare or inside its verdict; a `{ authorized: true }`
 * literal, a copy, a boolean or nothing refuses as `'invalid'`.
 */
export function verdictFrom(result: PreviewAuthorizationHookResult): PreviewAuthorization {
  if (isAuthorizedPreviewContext(result)) {
    return { authorized: true, outcome: 'authorized', context: result };
  }
  if (typeof result === 'object' && result !== null && 'authorized' in result) {
    if (result.authorized && isAuthorizedPreviewContext(result.context)) {
      return { authorized: true, outcome: 'authorized', context: result.context };
    }
    return refused(result.authorized ? 'invalid' : result.outcome);
  }
  // `null`, `undefined`, a boolean, a look-alike literal: refused.
  return refused('invalid');
}

/**
 * Run a bound hook: a `PreviewConfigurationError` is re-thrown so a
 * misconfigured strategy is loud, any other failure is the `'unavailable'`
 * refusal — an identity provider being down must never authorize.
 */
export async function runAuthorizeHook(hook: BoundAuthorizeHook): Promise<PreviewAuthorization> {
  let result: PreviewAuthorizationHookResult;
  try {
    result = await hook();
  } catch (error) {
    if (isPreviewConfigurationError(error)) throw error;
    return refused('unavailable');
  }
  return verdictFrom(result);
}
