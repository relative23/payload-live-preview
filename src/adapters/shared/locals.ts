/** What a decision publishes for templates on `locals` (Astro, SvelteKit) or `event.context` (Nuxt). */

import { createPreviewBindings, type PreviewBindings } from '@dsl/preview-bindings';
import type { PreviewAuthorizationOutcome } from '@security/preview-verdict';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import type { PreviewDecision } from './policy';

/**
 * The keys the adapters publish on the request-scoped context — `Astro.locals`,
 * SvelteKit's `event.locals`, Nuxt's `event.context`. Extend the framework's
 * `App.Locals` with it and templates read them typed. Every key is optional:
 * a refused preview withholds them all, and Next.js has no locals at all.
 */
export interface LivePreviewLocals {
  /**
   * The request-scoped CSP nonce, for templates that nonce their own scripts.
   * Set by the Astro middleware (prerendered pages included), the SvelteKit
   * handle and the Nuxt server handler or plugin on every request — except a
   * preview the `authorizePreview` hook refused, which gets no preview artefact.
   */
  readonly livePreviewNonce?: string;
  /** The verified `AuthorizedPreviewContext`. Set only when `authorizePreview` authorized an intent-bearing request. */
  readonly livePreviewAuthorization?: AuthorizedPreviewContext;
  /** The hook's `PreviewAuthorizationOutcome`, refusals included. Set whenever the hook ran: on intent, with `authorizePreview` configured. */
  readonly livePreviewAuthorizationOutcome?: PreviewAuthorizationOutcome;
}

/** The request-scoped nonce, for templates that nonce their own scripts. @internal */
export const NONCE_LOCALS_KEY = 'livePreviewNonce' satisfies keyof LivePreviewLocals;

/** The verified `AuthorizedPreviewContext`; absent unless `authorizePreview` authorized. @internal */
export const AUTHORIZATION_LOCALS_KEY =
  'livePreviewAuthorization' satisfies keyof LivePreviewLocals;

/** The hook's `PreviewAuthorizationOutcome`; absent when no hook ran. @internal */
export const AUTHORIZATION_OUTCOME_LOCALS_KEY =
  'livePreviewAuthorizationOutcome' satisfies keyof LivePreviewLocals;

/**
 * What an adapter needs of a framework's request context: the three keys it
 * writes, and nothing else.
 *
 * This is what the adapters' event types declare rather than
 * `Record<string, unknown>`. A framework's own `App.Locals` is an interface
 * without an index signature, so it is not assignable to a record — which made
 * composing our handle with SvelteKit's `Handle` type fail to compile, even
 * though the values matched. The adapters assign through the interface's own
 * keys, so the published type cannot drift from what the code writes either.
 */
export type LivePreviewLocalsSink = {
  -readonly [K in keyof LivePreviewLocals]: LivePreviewLocals[K];
};

/** Publish the nonce alone — a prerendered page has no request to decide for. */
export function exposeNonce(locals: LivePreviewLocalsSink, nonce: string): void {
  locals.livePreviewNonce = nonce;
}

/** Publish what templates may read; after a refusal the nonce is withheld like every other preview artefact. */
export function exposeDecision(
  locals: LivePreviewLocalsSink,
  decision: PreviewDecision,
  nonce: string,
): void {
  if (decision.exposeNonce || !decision.isPreview) locals.livePreviewNonce = nonce;
  if (decision.authorization !== null) locals.livePreviewAuthorization = decision.authorization;
  if (decision.outcome !== undefined) locals.livePreviewAuthorizationOutcome = decision.outcome;
}

/**
 * The binding helpers for one request, read straight off whatever the framework
 * calls locals — `Astro.locals`, SvelteKit's `event.locals`, Nuxt's
 * `event.context`.
 *
 * `createPreviewBindings({ authorization: locals.livePreviewAuthorization })`
 * says the same thing, and a template that spells it out is welcome to. This
 * exists because generated code should not have to: the build-time annotator
 * writes one call per component, and a helper that takes `unknown` needs no
 * `App.Locals` declaration in the project it writes into. The verdict is
 * checked, not trusted — only a context `authorizePreviewRequest()` produced
 * emits anything (ADR 0006).
 * @internal
 */
export function previewBindingsFromLocals(
  locals: unknown,
  options: { readonly owner?: string } = {},
): PreviewBindings {
  const value =
    typeof locals === 'object' && locals !== null
      ? (locals as Record<string, unknown>)[AUTHORIZATION_LOCALS_KEY]
      : undefined;
  return createPreviewBindings({
    authorization: (value ?? null) as AuthorizedPreviewContext | null,
    ...(options.owner !== undefined ? { owner: options.owner } : {}),
  });
}
