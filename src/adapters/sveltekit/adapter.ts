/**
 * SvelteKit adapter: a `handle` hook for `hooks.server.ts`. Composes with
 * `sequence()` and never short-circuits the chain.
 */

import { injectIntoHead } from '@adapters/shared/html-inject';
import { createPreviewPolicy, type PreviewPolicy } from '@adapters/shared/policy';
import { bindDecisionHooks, withCspHeader } from '@adapters/shared/response';
import { exposeDecision, type LivePreviewLocalsSink } from '@adapters/shared/locals';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import type { PageFacts } from '@adapters/shared/policy-options';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';

export type { PreviewAdapterOptions } from '@adapters/shared/options';
export type { LivePreviewLocals } from '@adapters/shared/locals';

export type LivePreviewSvelteKitOptions = PreviewAdapterOptions;

/**
 * A SvelteKit page that runs SvelteKit's client is hydrated by Svelte, which
 * sets its own text back over a value written before it (ADR 0015, addendum
 * of 2026-10-01). So every script this handle emits declares it, and the
 * runtime holds its first write until SvelteKit's root has mounted; a page
 * served with `csr = false` has no client and starts at once.
 */
const SVELTEKIT_PAGE: PageFacts = {
  hydration: 'sveltekit',
  softNavigationEvents: [NAVIGATION_COMMIT_EVENT],
};

interface SvelteKitRequestEvent {
  readonly request: Request;
  readonly locals: LivePreviewLocalsSink;
  /** SvelteKit removes its internal data suffix here before hooks run. */
  readonly url?: URL;
  readonly isDataRequest?: boolean;
}
interface ResolveOptions {
  readonly transformPageChunk?: (input: { html: string; done: boolean }) => string | undefined;
}
type SvelteKitResolve<Event> = (
  event: Event,
  opts?: ResolveOptions,
) => Response | Promise<Response>;

/**
 * Generic in the event, so the handle composes with SvelteKit's own `Handle`.
 * A fixed shim type would only work one way: SvelteKit's real `RequestEvent`
 * is assignable to the shim, but its `resolve` — which takes that real event —
 * is not assignable to a resolve that takes the shim. Passing the event
 * through by type parameter is the same shim from the other side.
 */
export type SvelteKitHandle = <Event extends SvelteKitRequestEvent>(input: {
  readonly event: Event;
  readonly resolve: SvelteKitResolve<Event>;
}) => Promise<Response>;

/**
 * The `handle` hook: it decides before rendering and publishes the verdict on
 * `event.locals`, rewrites the `<head>` chunk through `transformPageChunk`,
 * then merges CSP and marks the response uncacheable.
 */
export function livePreviewHandle(options: LivePreviewSvelteKitOptions = {}): SvelteKitHandle {
  const policy = createPreviewPolicy(options, SVELTEKIT_PAGE);
  return async ({ event, resolve }) => {
    const request = previewRequest(event);
    const nonce = policy.nonce();
    const decision = await policy.decide(request, bindDecisionHooks(policy, options, request));
    exposeDecision(event.locals, decision, nonce);
    const transform = decision.inject ? chunk(policy, nonce) : undefined;
    const response = await resolve(
      event,
      transform !== undefined ? { transformPageChunk: transform } : {},
    );
    if (!decision.inject && decision.cspMode === false) return response;
    return withCspHeader(response, policy, decision, nonce);
  };
}

/** A client navigation asks for `/__data.json`; authorization belongs to the page URL SvelteKit exposes. */
function previewRequest(event: SvelteKitRequestEvent): Request {
  if (event.isDataRequest !== true || event.url === undefined) return event.request;
  return new Request(event.url, event.request);
}

type ChunkTransform = NonNullable<ResolveOptions['transformPageChunk']>;

// Called per chunk; only the one carrying `<head>` is touched. SvelteKit
// replaces a falsy return with '', so a declined chunk must be returned as-is.
function chunk(policy: PreviewPolicy, nonce: string): ChunkTransform {
  const tag = policy.scriptTag(nonce);
  return ({ html }) => injectIntoHead(html, tag) ?? html;
}
