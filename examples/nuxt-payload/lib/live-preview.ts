/**
 * The options the Nuxt module and the asset route share.
 *
 * The module serializes them into the generated Nitro plugin at build time; the
 * route reads `assetPath` and `runtime` out of the same object at request time.
 * Keeping them in one file is what stops the bootstrap from asking for a path
 * the route does not answer.
 */
export const livePreviewOptions = {
  // The production gate serves this app over TLS on another port and says so.
  allowedOrigins: [process.env['PAYLOAD_ADMIN_ORIGIN'] ?? 'http://localhost:4176'],
  debug: true,
  debounceMs: 25,
  revealEditedField: true,
  // Server-rendered boundaries: /hybrid marks one, every other page has none
  // and is patched as before. Exercised by nuxt-fragment.spec.ts.
  fragments: { endpoint: '/payload/fragment' },
  // This fixture is the asset-delivery showcase: pages carry the bootstrap and
  // the runtime arrives from `server/routes/payload-live-preview/[file]`. The
  // Next.js fixture shows both deliveries side by side, the SvelteKit one
  // splits by route; here it is the whole app, so the fragment endpoint and
  // Vue's hydration are exercised against a runtime that arrives late.
  delivery: 'asset',
  // Staged on the 1.x profile: this fixture exercises the runtime mechanics.
  // The v2 defaults with a real authorized context are shown by the SvelteKit
  // fixture (defaults: 'v2' + authorizePreview) and the real-payload suites,
  // which also run this one: with PLP_PAYLOAD_SERVER_URL set it is strict and
  // the editor's session decides.
  ...(process.env['PLP_PAYLOAD_SERVER_URL']
    ? ({
        defaults: 'v2',
        authorizePreviewModule: './server/utils/live-preview-auth',
      } as const)
    : ({ defaults: 'v1' } as const)),
} as const;
