/**
 * Authorized preview context: the one verdict every privileged preview
 * decision is keyed on. Intent (`?preview=true`, an iframe destination, a
 * referer) is client-chosen; this turns a session, a signed token or the
 * application's own verifier into a branded context. Threat model: ADR 0006.
 */

import {
  AUTHORIZED_PREVIEW_BRAND_KEY,
  createAuthorizedPreviewContext,
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type PreviewAuthorizationStrategyName,
} from '@/types/authorized-preview';
import {
  refused,
  type PreviewAuthorization,
  type PreviewAuthorizationRequest,
} from './preview-verdict';
import { authorizeSession, type PayloadSessionStrategy } from './preview-session';
import { authorizeToken, type SignedTokenStrategy } from './preview-token';

export {
  AUTHORIZED_PREVIEW_BRAND_KEY,
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type PreviewAuthorizationStrategyName,
};
export {
  PreviewConfigurationError,
  type PreviewAuthorization,
  type PreviewAuthorizationOutcome,
  type PreviewAuthorizationRequest,
} from './preview-verdict';
export { extractCookie, type FetchLike, type PayloadSessionStrategy } from './preview-session';
export {
  issuePreviewToken,
  type IssuePreviewTokenOptions,
  type PreviewTokenClaims,
  type PreviewTokenReplayStore,
  type PreviewTokenTransport,
  type SignedTokenStrategy,
  type SubtleCryptoLike,
} from './preview-token';

/** Claims a consumer verifier returns for a request it accepts. */
export interface PreviewVerifierClaims {
  readonly subject?: string;
  readonly expiresAt?: number;
  readonly scope?: AuthorizedPreviewScope;
  readonly payloadHeaders?: Readonly<Record<string, string>>;
}

/** The application's own verification: claims authorize, `null` refuses, a throw is `unavailable`. */
export interface VerifierStrategy {
  readonly type: 'verifier';
  readonly verify: (
    request: PreviewAuthorizationRequest,
  ) => Promise<PreviewVerifierClaims | null> | PreviewVerifierClaims | null;
  readonly now?: () => number;
}

export type PreviewAuthorizationStrategy =
  PayloadSessionStrategy | SignedTokenStrategy | VerifierStrategy;

/** Decide whether `request` is an authorized preview; refusals resolve to `{ authorized: false }` and only a `PreviewConfigurationError` throws. */
export async function authorizePreviewRequest(
  request: PreviewAuthorizationRequest,
  strategy: PreviewAuthorizationStrategy,
): Promise<PreviewAuthorization> {
  switch (strategy.type) {
    case 'payload-session':
      return authorizeSession(request, strategy);
    case 'signed-token':
      return authorizeToken(request, strategy);
    case 'verifier':
      return authorizeVerifier(request, strategy);
  }
}

async function authorizeVerifier(
  request: PreviewAuthorizationRequest,
  strategy: VerifierStrategy,
): Promise<PreviewAuthorization> {
  let claims: PreviewVerifierClaims | null;
  try {
    claims = await strategy.verify(request);
  } catch {
    return refused('unavailable');
  }
  if (claims === null) return refused('invalid');
  const now = (strategy.now ?? Date.now)();
  if (claims.expiresAt !== undefined && claims.expiresAt <= now) return refused('expired');
  return {
    authorized: true,
    outcome: 'authorized',
    context: createAuthorizedPreviewContext({
      strategy: 'verifier',
      subject: claims.subject,
      authorizedAt: now,
      expiresAt: claims.expiresAt,
      scope: claims.scope ?? {},
      payloadHeaders: claims.payloadHeaders ?? {},
    }),
  };
}
