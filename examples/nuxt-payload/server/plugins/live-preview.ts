/**
 * Nitro plugin wiring for Payload Live Preview.
 *
 * `livePreviewNitroPlugin` hooks `render:html`, injects the inline runtime into
 * the head of responses carrying preview intent (`?preview=true`,
 * `Sec-Fetch-Dest: iframe`, or an admin referer) and merges the CSP so the
 * Payload admin may embed the page.
 *
 * The default `inject: 'preview-only'` mode is kept deliberately: the mock
 * admin loads `/` in an iframe, so that request carries `Sec-Fetch-Dest:
 * iframe` and gets the script, while a plain top-level navigation stays
 * untouched. The E2E spec asserts both halves.
 */
import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';

export default defineNitroPlugin(
  livePreviewNitroPlugin({
    allowedOrigins: ['http://localhost:4176'],
    debug: true,
    debounceMs: 25,
    // Staged on the 1.x profile: this fixture exercises the runtime mechanics.
    // The v2 defaults with a real authorized context are shown by the SvelteKit
    // fixture (defaults: 'v2' + authorizePreview) and the real-payload suites.
    defaults: 'v1',
  }),
);
