/**
 * Next.js adapter. The script goes into the root layout, because
 * `NextResponse.next()` carries no body for the middleware to inject into:
 * `livePreviewScriptProps()` for the App Router's JSX, `renderLivePreviewScript()`
 * for HTML a server assembles as a string.
 */

import {
  createPreviewPolicy,
  type PreviewDecision,
  type PreviewPolicy,
} from '@adapters/shared/policy';
import {
  applyDecision,
  bindDecisionHooks,
  injectIntoResponse,
  renderScriptTag,
  withCspHeader,
} from '@adapters/shared/response';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import { warnOnce } from '@/types/dev-warning';
import { REACT_PAGE, scriptElementProps, type LivePreviewScriptProps } from './script-element';

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
  const policy = createPreviewPolicy(options, REACT_PAGE);
  return async (request, response) => {
    const decision = await policy.decide(request, bindDecisionHooks(policy, options, request));
    if (!decision.isPreview) return response;
    return decision.cspMode === 'full'
      ? withCarriedNonce(response, policy, decision)
      : applyDecision(response, policy, decision, policy.nonce());
  };
}

/**
 * `manageCsp: 'full'` lets only a script that carries its nonce run. In
 * `proxy.ts` the response is `NextResponse.next()`, which has no body, and the
 * layout renders the script without ever seeing that nonce; a `script-src`
 * nonce nothing carries would block it and Next's own inline scripts. A
 * response the middleware cannot inject into therefore keeps `frame-ancestors`.
 */
async function withCarriedNonce(
  response: Response,
  policy: PreviewPolicy,
  decision: PreviewDecision,
): Promise<Response> {
  const nonce = policy.nonce();
  if (decision.inject) {
    const injected = await injectIntoResponse(response, policy.scriptTag(nonce));
    if (injected !== response) return withCspHeader(injected, policy, decision, nonce);
  }
  warnOnce(
    'nextjs-full-csp-without-carrier',
    "`manageCsp: 'full'` wrote `frame-ancestors` only: the middleware had no HTML body to put " +
      'the script in, and a nonce that reaches no script would block it. Keep `script-src` in your ' +
      'own policy and pass its nonce to `LivePreviewScript`.',
  );
  return withCspHeader(response, policy, { ...decision, cspMode: 'frame-ancestors' }, nonce);
}

export type { LivePreviewScriptProps } from './script-element';

/**
 * Props for the `<script>` in `app/layout.tsx`: a bootstrap that fetches the
 * runtime only in a preview context.
 *
 * ```tsx
 * <script {...livePreviewScriptProps({ ...livePreviewOptions, delivery: 'asset' })} />
 * ```
 *
 * Inline delivery left this helper in 3.0 (ADR 0007, row 32). A synchronous
 * helper cannot await an authorization verdict, so a root layout that rendered
 * it handed the whole runtime to every visitor, twice with React's flight
 * payload. `await LivePreviewScript({ request, ...options })` renders nothing
 * for a request the policy does not authorize.
 */
export function livePreviewScriptProps(
  options: LivePreviewNextOptions & { readonly delivery: 'asset'; readonly nonce?: string },
): LivePreviewScriptProps {
  // A JavaScript caller can still leave `delivery` out, or the options altogether.
  if ((options as { readonly delivery?: unknown } | undefined)?.delivery !== 'asset') {
    throw new Error(
      "payload-live-preview: `livePreviewScriptProps()` needs `delivery: 'asset'` since 3.0. " +
        'For an inline script render `await LivePreviewScript({ request, ...options })`, which ' +
        'renders nothing for a request it does not authorize (ADR 0007, row 32).',
    );
  }
  return scriptElementProps(options);
}

/**
 * The complete `<script>` tag, for HTML a server builds as a string. A JSX
 * framework cannot render it — use `livePreviewScriptProps()` there.
 */
export function renderLivePreviewScript(
  options: LivePreviewNextOptions & { readonly nonce?: string } = {},
): string {
  return renderScriptTag(options, REACT_PAGE);
}
