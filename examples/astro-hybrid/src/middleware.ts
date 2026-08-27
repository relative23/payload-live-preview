import { defineMiddleware, sequence } from 'astro:middleware';
import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
import { hasPreviewIntent } from 'payload-live-preview/server';
import { ADMIN_ORIGINS, mintToken } from './preview';

/** Whether the request is a preview framed by a trusted admin origin. */
function fromTrustedAdmin(request: Request): boolean {
  const referer = request.headers.get('referer');
  let refererOrigin: string | undefined;
  if (referer !== null) {
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = undefined;
    }
  }
  const site = request.headers.get('sec-fetch-site');
  return (
    (refererOrigin !== undefined && ADMIN_ORIGINS.includes(refererOrigin)) ||
    site === 'same-origin' ||
    site === 'same-site' ||
    site === 'cross-site'
  );
}

/**
 * Establish a preview token for a real cross-origin admin. The admin frames
 * this fixture with `?preview=true` and no token, and shares neither a URL
 * token nor a usable cross-site cookie (SameSite=None needs Secure, which the
 * http test origin cannot set). So the first framed request is redirected to
 * the same URL with a freshly minted `previewToken`: the reloaded page carries
 * it in `location.search`, the fragment client sends that search back, and the
 * endpoint authorizes via the query token — no cookie, http-safe. The bench
 * already carries a token and is left alone.
 */
const establishPreviewToken = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  if (
    !url.searchParams.has('previewToken') &&
    hasPreviewIntent(context.request) &&
    fromTrustedAdmin(context.request)
  ) {
    url.searchParams.set('previewToken', await mintToken(url.pathname));
    return context.redirect(url.pathname + url.search, 302);
  }
  return next();
});

// The page injects the runtime on preview intent; authorization is the
// fragment endpoint's, satisfied by the URL token (bench, and the real admin
// after the redirect above).
export const onRequest = sequence(
  establishPreviewToken,
  createLivePreviewMiddleware({
    // The page injects on intent and does not gate injection on authorization —
    // the real cross-origin admin shares no session with this fixture, and
    // authorization lives at the fragment endpoint instead. `defaults: 'v1'`
    // keeps injection ungated (2.0's strict default would require
    // authorizePreview here); the endpoint stays strict via its own strategy.
    defaults: 'v1',
    allowedOrigins: ADMIN_ORIGINS,
    fragments: { endpoint: '/payload/fragment' },
    debug: true,
    debounceMs: 25,
  }),
);
