/**
 * The fixture's preview authorization, in one place because three callers have
 * to agree on it: the root layout's `<LivePreviewScript />`, the fragment
 * endpoint, and the entry route the mock admin frames.
 *
 * A real deployment keeps the secret in the environment and shares it with the
 * Payload side, which mints the token inside its `livePreview.url` callback.
 * This example has no Payload behind it, so `/preview-session` mints instead;
 * the strategy the site verifies with is the real one, and so is everything
 * the tests assert.
 *
 * Two carriers, because Next gives a server component two different views of
 * the request:
 *
 * - **The query**, for the fragment endpoint. It rebuilds the page request
 *   from the boundary's `route` and `search`, so a token there stays bound to
 *   the path it was issued for — `mintRouteToken()`.
 * - **A cookie**, for the layout. A layout is handed the request headers and
 *   cookies but *not* its URL, so `?previewToken=` is invisible there; the one
 *   credential a layout can read is a cookie — `mintSessionToken()`.
 */
import {
  authorizePreviewRequest,
  extractCookie,
  issuePreviewToken,
  type PreviewAuthorization,
  type SignedTokenStrategy,
} from 'payload-live-preview/server';

/** Fixture secret — a real site reads it from the environment. */
const PREVIEW_SECRET = 'nextjs-hybrid-fixture-secret-that-is-long-enough-0';

export const SITE = 'http://localhost:4174';

/** The cookie `/preview-session` writes and the layout reads back. */
export const PREVIEW_COOKIE = 'previewToken';

/**
 * The header the cookie's token is handed to the strategy through. Nothing
 * sends this over the wire: it is the transport the verification uses once the
 * value has been taken out of the cookie.
 */
const TOKEN_HEADER = 'x-preview-token';

export const strategy: SignedTokenStrategy = {
  type: 'signed-token',
  secret: PREVIEW_SECRET,
  audience: SITE,
};

/** A token bound to one route, for the query the fragment endpoint verifies. */
export function mintRouteToken(path: string): Promise<string> {
  return issuePreviewToken({ audience: SITE, path, subject: 'editor' }, { secret: PREVIEW_SECRET });
}

/**
 * The token that goes in the cookie, minted **without** a path claim on
 * purpose: a cookie is sent to every path of the origin, so a path binding
 * would only be true of whichever page happened to be framed first. The path
 * binding lives on the query token above, which is the one that travels with a
 * single request.
 */
export function mintSessionToken(): Promise<string> {
  return issuePreviewToken({ audience: SITE, subject: 'editor' }, { secret: PREVIEW_SECRET });
}

/**
 * The layout's gate, and with `inject: 'always'` the only one: same secret,
 * same audience, same HMAC as the query token — only the carrier differs.
 */
export async function authorizePreview(request: Request): Promise<PreviewAuthorization> {
  const token = extractCookie(request.headers.get('cookie'), PREVIEW_COOKIE);
  if (token === null) return { authorized: false, outcome: 'missing-credential', context: null };
  return authorizePreviewRequest(
    { url: request.url, headers: new Headers({ [TOKEN_HEADER]: token }) },
    { ...strategy, transport: { kind: 'header', name: TOKEN_HEADER } },
  );
}
