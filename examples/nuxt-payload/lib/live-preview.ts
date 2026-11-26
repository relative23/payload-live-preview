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
  // The mock admin (`public/admin.html`) frames a page without a query, so the
  // iframe load is the signal here beside the query.
  previewSignals: ['query', 'fetch-dest'],
  // No response changes on intent alone: the hook decides, by reference
  // (ADR 0024). It reads the mock admin's session cookie, or, against a real
  // Payload admin, the editor's own session.
  authorizePreviewModule: './server/utils/live-preview-auth',
  // A real admin posts a relationship as an id; the runtime populates it from Payload's REST API as
  // the editor, so a binding on the populated path (`author.email`) has something to show.
  ...(process.env['PLP_PAYLOAD_SERVER_URL']
    ? ({ serverURL: process.env['PLP_PAYLOAD_SERVER_URL'], mergeDepth: 1 } as const)
    : {}),
} as const;
