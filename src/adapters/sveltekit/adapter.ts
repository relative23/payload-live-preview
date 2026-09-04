/**
 * SvelteKit adapter: a `handle` hook for `hooks.server.ts`. Composes with
 * `sequence()` and never short-circuits the chain.
 */

import { createPreviewPolicy, injectIntoHead, type PreviewPolicy } from '@adapters/shared/policy';
import { bindDecisionHooks, withCspHeader } from '@adapters/shared/response';
import { exposeDecision } from '@adapters/shared/locals';
import type { PreviewAdapterOptions } from '@adapters/shared/options';

export type { PreviewAdapterOptions } from '@adapters/shared/options';

export type LivePreviewSvelteKitOptions = PreviewAdapterOptions;

interface SvelteKitRequestEvent {
  readonly request: Request;
  readonly locals: Record<string, unknown>;
}
interface ResolveOptions {
  readonly transformPageChunk?: (input: { html: string; done: boolean }) => string | undefined;
}
type SvelteKitResolve = (event: SvelteKitRequestEvent, opts?: ResolveOptions) => Promise<Response>;
export type SvelteKitHandle = (input: {
  readonly event: SvelteKitRequestEvent;
  readonly resolve: SvelteKitResolve;
}) => Promise<Response>;

/**
 * The `handle` hook: it decides before rendering and publishes the verdict on
 * `event.locals`, rewrites the `<head>` chunk through `transformPageChunk`,
 * then merges CSP and marks the response uncacheable.
 */
export function livePreviewHandle(options: LivePreviewSvelteKitOptions = {}): SvelteKitHandle {
  const policy = createPreviewPolicy(options);
  return async ({ event, resolve }) => {
    const nonce = policy.nonce();
    const decision = await policy.decide(
      event.request,
      bindDecisionHooks(policy, options, event.request),
    );
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

type ChunkTransform = NonNullable<ResolveOptions['transformPageChunk']>;

// Called per chunk; only the one carrying `<head>` is touched. SvelteKit
// replaces a falsy return with '', so a declined chunk must be returned as-is.
function chunk(policy: PreviewPolicy, nonce: string): ChunkTransform {
  const tag = policy.scriptTag(nonce);
  return ({ html }) => injectIntoHead(html, tag) ?? html;
}
