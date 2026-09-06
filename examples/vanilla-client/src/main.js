// The npm-import path: a bundled app pulls initLivePreview from the package's
// /client entry and starts it itself — the LivePreviewClient class, not the
// baked inline script. Every JS-framework SPA (Remix, Solid, Vue, Svelte,
// Qwik) reduces to exactly this call, so proving it here proves them all.
import { initLivePreview } from 'payload-live-preview/client';
import { createUnboundFieldsOverlayPlugin } from 'payload-live-preview/plugins';

// initLivePreview returns the client when the page is a preview context, else
// null. Exposed for the E2E; a real app just keeps the handle (or ignores it).
// `data-debug="false"` on the page turns the client's debug mode off, which is
// how the E2E shows that the development overlay stays away without it.
const debug = document.documentElement.dataset.debug !== 'false';

window.__lpClient = initLivePreview({
  allowedOrigins: ['http://localhost:4181', 'http://127.0.0.1:4181'],
  debug,
  debounceMs: 25,
  revealEditedField: true,
});

// The unbound-fields overlay is a plugin, never part of the runtime: it lists
// the fields an update carried that this page has nowhere to put.
void window.__lpClient?.use(createUnboundFieldsOverlayPlugin());
