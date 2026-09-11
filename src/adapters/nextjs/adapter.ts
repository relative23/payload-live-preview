/**
 * Next.js adapter. The script goes into the root layout, because
 * `NextResponse.next()` carries no body for the middleware to inject into:
 * `livePreviewScriptProps()` for the App Router's JSX, `renderLivePreviewScript()`
 * for HTML a server assembles as a string.
 */

import { createPreviewPolicy } from '@adapters/shared/policy';
import {
  applyDecision,
  bindDecisionHooks,
  renderScriptBody,
  renderScriptTag,
} from '@adapters/shared/response';
import { assertNonce } from '@inline/generator';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import type { PageFacts } from '@adapters/shared/policy-options';

export type { PreviewAdapterOptions } from '@adapters/shared/options';

export type LivePreviewNextOptions = PreviewAdapterOptions;

/**
 * A Next page is a React tree, so every script this adapter emits declares
 * that React hydrates it (ADR 0015): the runtime then holds its first write
 * until React has committed the tree that holds the bindings, instead of
 * writing into markup React is about to compare with its own render. Knowledge
 * the adapter has, not an option a project sets.
 */
const REACT_PAGE: PageFacts = { hydration: 'react' };

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
    return applyDecision(response, policy, decision, policy.nonce());
  };
}

/** What a `<script>` element needs to carry the runtime; see `livePreviewScriptProps`. */
export interface LivePreviewScriptProps {
  readonly dangerouslySetInnerHTML: { readonly __html: string };
  /** Present only when a nonce was passed, so React omits the attribute otherwise. */
  readonly nonce?: string;
}

/**
 * Props for the `<script>` in `app/layout.tsx`:
 *
 * ```tsx
 * <script {...livePreviewScriptProps({ allowedOrigins: [ADMIN], serverURL: ADMIN, mergeDepth: 1 })} />
 * ```
 *
 * The nonce stays a prop rather than going into the body, because that is where
 * the framework — and any CSP handling built on it — expects the attribute.
 */
export function livePreviewScriptProps(
  options: LivePreviewNextOptions & { readonly nonce?: string } = {},
): LivePreviewScriptProps {
  const html = renderScriptBody(options, REACT_PAGE);
  if (options.nonce === undefined) return { dangerouslySetInnerHTML: { __html: html } };
  return {
    dangerouslySetInnerHTML: { __html: html },
    nonce: assertNonce(options.nonce),
  };
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
