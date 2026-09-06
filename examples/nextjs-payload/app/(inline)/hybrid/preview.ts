/**
 * The fixture's preview authorization. The fragment endpoint and the host page
 * share one strategy: the host mints a signed token for the route it frames,
 * and the endpoint verifies that same token on the fragment request, so a token
 * stays bound to the page it was issued for.
 */
import { issuePreviewToken, type SignedTokenStrategy } from 'payload-live-preview/server';

/** Fixture secret — a real site reads it from the environment. */
const PREVIEW_SECRET = 'nextjs-hybrid-fixture-secret-that-is-long-enough-0';

export const SITE = 'http://localhost:4174';

export const strategy: SignedTokenStrategy = {
  type: 'signed-token',
  secret: PREVIEW_SECRET,
  audience: SITE,
};

export function mintToken(path: string): Promise<string> {
  return issuePreviewToken({ audience: SITE, path, subject: 'editor' }, { secret: PREVIEW_SECRET });
}
