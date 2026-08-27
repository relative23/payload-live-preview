import { authorizePreviewRequest, type VerifierStrategy } from 'payload-live-preview/server';

/** Fixture secret — a real site reads it from the environment. */
export const PREVIEW_SECRET = 'astro-hybrid-fixture-secret-that-is-long-enough-000';
export const SITE = 'http://localhost:4177';
export const PAYLOAD_URL = 'http://localhost:3001';
export const ADMIN_ORIGINS = ['http://localhost:4177', 'http://127.0.0.1:4177', PAYLOAD_URL];

/**
 * Two ways in, one strategy: the bench page issues a signed token; the real
 * Payload admin (examples/payload-backend) has a session cookie the site
 * verifies against `/api/users/me`. The page middleware and the fragment
 * endpoint share it, so a fragment is authorized exactly like its page.
 */
export const strategy: VerifierStrategy = {
  type: 'verifier',
  verify: async (request) => {
    const token = await authorizePreviewRequest(request, {
      type: 'signed-token',
      secret: PREVIEW_SECRET,
      audience: SITE,
    });
    if (token.authorized) return { subject: token.context.subject ?? 'token' };
    const session = await authorizePreviewRequest(request, {
      type: 'payload-session',
      serverURL: PAYLOAD_URL,
    });
    if (session.authorized) return { subject: session.context.subject ?? 'session' };
    return null;
  },
};
