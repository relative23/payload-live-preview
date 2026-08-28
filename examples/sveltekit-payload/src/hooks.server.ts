/**
 * SvelteKit server hook for the live preview example.
 *
 * `livePreviewHandle` injects the inline runtime into the `<head>` of
 * responses that carry preview intent, merges a `frame-ancestors` CSP so
 * the admin may frame the page, and — since 1.1.0 — verifies that intent
 * before doing either. The hook below uses the `signed-token` strategy: a
 * request is a preview only if it carries a token bound to this site, this
 * path and the next few minutes. Everything else is a public response,
 * byte for byte.
 *
 * `defaults: 'v2'` implies `strict`: the handle refuses to start without the
 * hook and requires https admin origins outside development; the example
 * runs under `vite dev`, where http://localhost is allowed.
 */
import { livePreviewHandle } from 'payload-live-preview/sveltekit';
import { authorizePreviewRequest } from 'payload-live-preview';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '$lib/preview';

export const handle = livePreviewHandle({
  allowedOrigins: ['http://localhost:4175'],
  debug: true,
  debounceMs: 25,
  // Reveal the edited section. This fixture is the v2/strict showcase
  // (query-only intent + token), so a browser reveal E2E lives on the astro,
  // nextjs and nuxt fixtures instead; the runtime here is identical.
  revealEditedField: true,
  // Two documents may share a field name on one page (`/owners`); an update
  // names its document and patches only that one.
  scopeBindingsByOwner: true,
  // Every 2.0 default that exists today (ADR 0007): strict configuration,
  // query-only intent, no referrer trust, updates only from the window that
  // framed or opened the page, unchanged bindings skipped.
  defaults: 'v2',
  authorizePreview: (request) =>
    authorizePreviewRequest(request, {
      type: 'signed-token',
      secret: PREVIEW_TOKEN_SECRET,
      audience: PREVIEW_AUDIENCE,
    }),
});
