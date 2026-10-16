/**
 * A verifier-issued document capability for server and fragment contract tests.
 * The request body never supplies this binding; tests vary that body separately.
 */
import {
  authorizePreviewRequest,
  type PreviewVerifierClaims,
} from '@security/preview-authorization';

export const SCOPE_SITE = 'https://preview.example.test';
export const SCOPE_CMS = 'https://cms.example.test';

export function scopedClaims(): PreviewVerifierClaims {
  return {
    expiresAt: Date.now() + 60_000,
    scope: {
      audience: SCOPE_SITE,
      path: '/preview',
      locale: 'de',
      payload: {
        serverURL: SCOPE_CMS,
        document: { kind: 'collection', slug: 'posts', id: 'post-a' },
        maxDepth: 1,
      },
    },
    payloadHeaders: { cookie: 'payload-token=scoped-test-user' },
  };
}

export async function scopedContext(claims = scopedClaims()) {
  const verdict = await authorizePreviewRequest(new Request(`${SCOPE_SITE}/preview?locale=de`), {
    type: 'verifier',
    verify: () => claims,
  });
  if (!verdict.authorized) throw new Error('expected scoped test context');
  return verdict.context;
}
