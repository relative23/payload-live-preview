/**
 * The verdict shape every authorization strategy produces, and the one error
 * class that is allowed to escape it. Kept apart from the strategies so the
 * adapters can import the error without pulling in HMAC or session code.
 */

import type { AuthorizedPreviewContext } from '@/types/authorized-preview';

/** Why a request was refused. `'authorized'` is the one non-refusal. */
export type PreviewAuthorizationOutcome =
  | 'authorized'
  | 'missing-credential'
  | 'invalid'
  | 'expired'
  | 'wrong-audience'
  | 'wrong-path'
  | 'wrong-locale'
  | 'wrong-purpose'
  | 'replayed'
  | 'unavailable';

/** The result of `authorizePreviewRequest()`: a verdict, never an exception. */
export type PreviewAuthorization =
  | {
      readonly authorized: true;
      readonly outcome: 'authorized';
      readonly context: AuthorizedPreviewContext;
    }
  | {
      readonly authorized: false;
      readonly outcome: Exclude<PreviewAuthorizationOutcome, 'authorized'>;
      readonly context: null;
    };

/** The request shape every strategy reads: a URL and a header getter. */
export interface PreviewAuthorizationRequest {
  readonly url: string;
  readonly headers: { get(name: string): string | null };
}

/**
 * A strategy was misconfigured — raised on first use and re-thrown by the
 * adapters rather than reported as `'unavailable'`, so it fails loudly.
 */
export class PreviewConfigurationError extends Error {
  override readonly name = 'PreviewConfigurationError';
}

/** Recognises the error across bundles, where `instanceof` sees a different class copy. */
export function isPreviewConfigurationError(error: unknown): error is PreviewConfigurationError {
  return (
    error instanceof PreviewConfigurationError ||
    (error instanceof Error && error.name === 'PreviewConfigurationError')
  );
}

export function refused(
  outcome: Exclude<PreviewAuthorizationOutcome, 'authorized'>,
): PreviewAuthorization {
  return { authorized: false, outcome, context: null };
}
