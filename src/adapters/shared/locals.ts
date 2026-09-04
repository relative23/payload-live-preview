/** What a decision publishes for templates on `locals` (Astro, SvelteKit) or `event.context` (Nuxt). */

import type { PreviewDecision } from './policy';

/** The request-scoped nonce, for templates that nonce their own scripts. */
export const NONCE_LOCALS_KEY = 'livePreviewNonce';

/** The verified `AuthorizedPreviewContext`; absent unless `authorizePreview` authorized. */
export const AUTHORIZATION_LOCALS_KEY = 'livePreviewAuthorization';

/** The hook's `PreviewAuthorizationOutcome`; absent when no hook ran. */
export const AUTHORIZATION_OUTCOME_LOCALS_KEY = 'livePreviewAuthorizationOutcome';

/** Publish what templates may read; after a refusal the nonce is withheld like every other preview artefact. */
export function exposeDecision(
  locals: Record<string, unknown>,
  decision: PreviewDecision,
  nonce: string,
): void {
  if (decision.exposeNonce || !decision.isPreview) locals[NONCE_LOCALS_KEY] = nonce;
  if (decision.authorization !== null) locals[AUTHORIZATION_LOCALS_KEY] = decision.authorization;
  if (decision.outcome !== undefined) locals[AUTHORIZATION_OUTCOME_LOCALS_KEY] = decision.outcome;
}
