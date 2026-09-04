/**
 * Astro middleware: decides before rendering so templates can read
 * `Astro.locals`, then injects into the HTML response and merges CSP.
 * Prerendered pages are skipped — there is no request to decide for at build time.
 */

import { createPreviewPolicy } from '@adapters/shared/policy';
import { applyDecision, bindDecisionHooks } from '@adapters/shared/response';
import { exposeDecision, NONCE_LOCALS_KEY } from '@adapters/shared/locals';
import type { LivePreviewAstroOptions } from './types';

export {
  AUTHORIZATION_LOCALS_KEY,
  AUTHORIZATION_OUTCOME_LOCALS_KEY,
  NONCE_LOCALS_KEY,
} from '@adapters/shared/locals';

// Local shims keep `astro` a runtime-optional peer; the runtime signature matches.
type MiddlewareNext = () => Promise<Response>;
interface MiddlewareContext {
  readonly request: Request;
  readonly locals: Record<string, unknown>;
  /** Astro ≥ 5: `true` while prerendering at build time. */
  readonly isPrerendered?: boolean;
}
export type LivePreviewMiddleware = (
  context: MiddlewareContext,
  next: MiddlewareNext,
) => Promise<Response>;

/** Build the middleware; it publishes the nonce, the context and the outcome on `Astro.locals`. */
export function createLivePreviewMiddleware(
  options: LivePreviewAstroOptions = {},
): LivePreviewMiddleware {
  const policy = createPreviewPolicy(options);
  return async (context, next) => {
    const nonce = policy.nonce();
    if (context.isPrerendered === true) {
      context.locals[NONCE_LOCALS_KEY] = nonce;
      return next();
    }
    const decision = await policy.decide(
      context.request,
      bindDecisionHooks(policy, options, context.request),
    );
    exposeDecision(context.locals, decision, nonce);
    const response = await next();
    if (!decision.isPreview) return response;
    return applyDecision(response, policy, decision, nonce);
  };
}
