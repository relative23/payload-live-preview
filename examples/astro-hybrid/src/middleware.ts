import { defineMiddleware, sequence } from 'astro:middleware';
import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
import { authorizePreviewRequest, hasPreviewIntent } from 'payload-live-preview/server';
import { ADMIN_ORIGINS, mintToken, strategy } from './preview';

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

// The page injects on intent and does not gate injection on authorization —
// the real cross-origin admin shares no session with this fixture, and
// authorization lives at the fragment endpoint instead. `defaults: 'v1'`
// keeps injection ungated (2.0's strict default would require
// authorizePreview here); the endpoint stays strict via its own strategy.
const COMMON = {
  defaults: 'v1',
  allowedOrigins: ADMIN_ORIGINS,
  debug: true,
  debounceMs: 25,
} as const;

/** Every route but `/unbound`: the fragment client, and no route fallback. */
const withFragments = createLivePreviewMiddleware({
  ...COMMON,
  fragments: { endpoint: '/payload/fragment' },
});

/**
 * `/unbound` alone: the route strategy without a fragment endpoint, and the
 * fallback that refreshes the route when a revision changes a field the page
 * has no binding for.
 *
 * A second middleware rather than one option more on the first: adapter options
 * are per site, and turning the fallback on for every route would change what
 * the fragment spec measures — a route refresh where it expects a patch.
 */
const withRouteFallback = createLivePreviewMiddleware({
  ...COMMON,
  routeStrategy: true,
  onUnboundChange: 'route',
});

/**
 * `/annotated` alone: the same options plus the hook, because that page carries
 * no binding attributes of its own. `livePreviewAnnotate()` rewrote them into
 * calls against `Astro.locals.livePreviewAuthorization`, and only a middleware
 * that runs `authorizePreview` puts a verdict there.
 */
const withAuthorization = createLivePreviewMiddleware({
  ...COMMON,
  fragments: { endpoint: '/payload/fragment' },
  authorizePreview: (request) => authorizePreviewRequest(request, strategy),
});

export const onRequest = sequence(
  establishPreviewToken,
  defineMiddleware((context, next) => {
    if (context.url.pathname.startsWith('/unbound')) return withRouteFallback(context, next);
    if (context.url.pathname.startsWith('/annotated')) return withAuthorization(context, next);
    return withFragments(context, next);
  }),
);
