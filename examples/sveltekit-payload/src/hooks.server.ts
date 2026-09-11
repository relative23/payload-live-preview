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
 *
 * Two handles, differing in one option. Everything is delivered inline except
 * `/asset`, which carries the bootstrap and fetches the runtime from
 * `src/routes/payload-live-preview/[file]` — so one dev server shows both
 * deliveries, and the split is per route because a handle sees the request.
 */
import type { Handle } from '@sveltejs/kit';
import {
  livePreviewHandle,
  type LivePreviewSvelteKitOptions,
} from 'payload-live-preview/sveltekit';
import { authorizePreviewRequest } from 'payload-live-preview';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '$lib/preview';

const options = {
  allowedOrigins: ['http://localhost:4175'],
  debug: true,
  debounceMs: 25,
  // Reveal the edited section. `/reveal` is this fixture's row in
  // reveal.spec.ts; the test mints the token for that route itself, since
  // the mock admin only mints for the routes on its allowlist.
  revealEditedField: true,
  // Two documents may share a field name on one page (`/owners`); an update
  // names its document and patches only that one.
  scopeBindingsByOwner: true,
  // Server-rendered boundaries: /hybrid marks one, every other route has none
  // and is patched as before. Exercised by sveltekit-fragment.spec.ts.
  fragments: { endpoint: '/payload/fragment' },
  // Every 2.0 default that exists today (ADR 0007): strict configuration,
  // query-only intent, no referrer trust, updates only from the window that
  // framed or opened the page, unchanged bindings skipped.
  defaults: 'v2',
  authorizePreview: (request: Request) =>
    authorizePreviewRequest(request, {
      type: 'signed-token',
      secret: PREVIEW_TOKEN_SECRET,
      audience: PREVIEW_AUDIENCE,
    }),
} satisfies LivePreviewSvelteKitOptions;

export const assetOptions = { ...options, delivery: 'asset' } as const;

const inline = livePreviewHandle(options);
const asset = livePreviewHandle(assetOptions);

export const handle: Handle = (input) =>
  input.event.url.pathname.startsWith('/asset') ? asset(input) : inline(input);
