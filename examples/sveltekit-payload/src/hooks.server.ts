/**
 * SvelteKit server hook wiring for Payload Live Preview.
 *
 * `livePreviewHandle` injects the inline runtime into the `<head>` of
 * preview responses (detected via `?preview=true`, `Sec-Fetch-Dest:
 * iframe`, or an admin referer) and merges the CSP `frame-ancestors`
 * so the Payload admin may embed the page. The default
 * `inject: 'preview-only'` mode is kept on purpose: the mock admin
 * loads `/` inside an iframe, so the request carries
 * `Sec-Fetch-Dest: iframe` and gets the script — while a plain
 * top-level navigation to `/` stays untouched, which the E2E spec
 * relies on for its origin-enforcement test.
 */
import { livePreviewHandle } from '@relative23/payload-live-preview/sveltekit';

export const handle = livePreviewHandle({
  allowedOrigins: ['http://localhost:4175'],
  debug: true,
  debounceMs: 25,
});
