---
'payload-live-preview': patch
---

One name and one shape per option, across the adapters, the intent detector
and the fragment endpoint:

- `hasPreviewIntent()` takes `allowedOrigins`, the name the adapters, the
  client, the inline config and `pll doctor` already use. `adminOrigins` keeps
  working as a deprecated alias until 3.0; `allowedOrigins` wins when both are
  given.
- `createFragmentEndpoint()` accepts `authorizePreview` — the page
  middleware's hook, with the same callback type and the same verdict rules
  (a context or an `authorizePreviewRequest()` verdict authorizes, anything
  else refuses, a `PreviewConfigurationError` is loud) — called with the page
  request the fragment belongs to. `authorize` still takes a strategy; giving
  both throws at construction, naming both.
- `LivePreviewLocals`, exported from `./astro`, `./sveltekit` and `./nuxt`,
  types what the adapters publish on `Astro.locals`, `event.locals` and
  `event.context` (`livePreviewNonce`, `livePreviewAuthorization`,
  `livePreviewAuthorizationOutcome`). The adapters write through it, so
  `interface Locals extends LivePreviewLocals {}` cannot drift from the code.
