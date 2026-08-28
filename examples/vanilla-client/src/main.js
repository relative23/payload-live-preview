// The npm-import path: a bundled app pulls initLivePreview from the package's
// /client entry and starts it itself — the LivePreviewClient class, not the
// baked inline script. Every JS-framework SPA (Remix, Solid, Vue, Svelte,
// Qwik) reduces to exactly this call, so proving it here proves them all.
import { initLivePreview } from 'payload-live-preview/client';

// initLivePreview returns the client when the page is a preview context, else
// null. Exposed for the E2E; a real app just keeps the handle (or ignores it).
window.__lpClient = initLivePreview({
  allowedOrigins: ['http://localhost:4181', 'http://127.0.0.1:4181'],
  debug: true,
  debounceMs: 25,
  revealEditedField: true,
});
