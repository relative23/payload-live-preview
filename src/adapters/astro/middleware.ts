/**
 * Astro middleware: decides before rendering so templates can read
 * `Astro.locals`, then injects into the HTML response and merges CSP.
 * Prerendered pages are skipped — there is no request to decide for at build time.
 */

import { createPreviewPolicy } from '@adapters/shared/policy';
import { applyDecision, bindDecisionHooks } from '@adapters/shared/response';
import { exposeDecision, exposeNonce, type LivePreviewLocalsSink } from '@adapters/shared/locals';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import { ASTRO_PAGE } from './page-facts';

export type { LivePreviewLocals } from '@adapters/shared/locals';

// Local shims keep `astro` a runtime-optional peer; the runtime signature matches.
type MiddlewareNext = () => Promise<Response>;
interface MiddlewareContext {
  readonly request: Request;
  readonly locals: LivePreviewLocalsSink;
  /** Astro ≥ 5: `true` while prerendering at build time. */
  readonly isPrerendered?: boolean;
}
export type LivePreviewMiddleware = (
  context: MiddlewareContext,
  next: MiddlewareNext,
) => Promise<Response>;

/**
 * Build the middleware; it publishes the nonce, the context and the outcome on `Astro.locals`.
 * It runs per request, so `authorizePreview` and `shouldInject` belong here and not on the
 * integration's options.
 */
export function createLivePreviewMiddleware(
  options: PreviewAdapterOptions = {},
): LivePreviewMiddleware {
  const policy = createPreviewPolicy(options, ASTRO_PAGE);
  return async (context, next) => {
    const nonce = policy.nonce();
    if (context.isPrerendered === true) {
      exposeNonce(context.locals, nonce);
      return next();
    }
    context.locals.livePreviewRequiresAuthorization = true;
    const decision = await policy.decide(
      context.request,
      bindDecisionHooks(options, context.request),
    );
    exposeDecision(context.locals, decision, nonce);
    const response = await next();
    if (!decision.isPreview) return response;
    return applyDecision(response, policy, decision, nonce);
  };
}
