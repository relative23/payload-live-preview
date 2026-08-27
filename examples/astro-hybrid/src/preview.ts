import { issuePreviewToken, type SignedTokenStrategy } from 'payload-live-preview/server';

/** Fixture secret — a real site reads it from the environment. */
export const PREVIEW_SECRET = 'astro-hybrid-fixture-secret-that-is-long-enough-000';
export const SITE = 'http://localhost:4177';
export const ADMIN_ORIGINS = [
  'http://localhost:4177',
  'http://127.0.0.1:4177',
  'http://localhost:3001',
];

/** Mint a signed preview token for a page route (bench URL and the admin redirect). */
export function mintToken(path: string): Promise<string> {
  return issuePreviewToken({ audience: SITE, path, subject: 'editor' }, { secret: PREVIEW_SECRET });
}

/**
 * The fragment endpoint authorizes a preview by the signed token in the page
 * URL — the bench issues one, and the page middleware redirects a real
 * cross-origin admin to a tokened URL. One strategy serves both.
 */
export const strategy: SignedTokenStrategy = {
  type: 'signed-token',
  secret: PREVIEW_SECRET,
  audience: SITE,
};
