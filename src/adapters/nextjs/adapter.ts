/**
 * Next.js adapter. `renderLivePreviewScript()` in the root layout is the
 * primary wiring: `NextResponse.next()` carries no body, so the middleware
 * only injects into responses that actually carry HTML.
 */

import { createPreviewPolicy } from '@adapters/shared/policy';
import { applyDecision, bindDecisionHooks, renderScriptTag } from '@adapters/shared/response';
import type { PreviewAdapterOptions } from '@adapters/shared/options';

export type { PreviewAdapterOptions } from '@adapters/shared/options';

export type LivePreviewNextOptions = PreviewAdapterOptions;

/**
 * Middleware over the standard `Request`/`Response` pair: on preview intent it
 * authorizes, injects, merges CSP and marks the response uncacheable. Next.js
 * middleware has no `locals`, so the verdict is not published — call
 * `authorizePreviewRequest()` in the route when a page needs it.
 */
export function createLivePreviewMiddleware(
  options: LivePreviewNextOptions = {},
): (request: Request, response: Response) => Promise<Response> {
  const policy = createPreviewPolicy(options);
  return async (request, response) => {
    const decision = await policy.decide(request, bindDecisionHooks(policy, options, request));
    if (!decision.isPreview) return response;
    return applyDecision(response, policy, decision, policy.nonce());
  };
}

/** The `<script>` tag for `app/layout.tsx`; pass the nonce your CSP uses. */
export function renderLivePreviewScript(
  options: LivePreviewNextOptions & { readonly nonce?: string } = {},
): string {
  return renderScriptTag(options);
}
