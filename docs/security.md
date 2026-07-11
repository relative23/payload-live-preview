# Security model

The threat model is **a malicious parent window**: anything that postMessages the preview page is treated as untrusted until verified.

## Layered defences

### 1. Origin allow-list

Inbound `postMessage` events are dropped unless `event.origin` matches one of:

- An explicit origin from `allowedOrigins` (or `PAYLOAD_ADMIN_ORIGIN` env var).
- The captured `document.referrer` origin (only when the preview page is loaded inside an iframe).
- A localhost pattern (`/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i`) — only in development.

After the first valid update, the detector **locks** to that exact origin. Subsequent messages from any other origin (including ones in the original allow-list) are dropped.

### 2. Message-shape validation

`MessageBus` validates that:

- `event.data` is an `object`,
- `data.type` is one of `payload-live-preview` / `payload-document-event`,

before routing further. Unknown types fall into an `onInvalid('type', origin)` callback for telemetry.

### 3. HTML sanitisation

Lexical output and `html`-typed fields run through a curated DOM sanitiser:

- **Allow-listed tags only.** Removes `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<form>` and every form control, `<svg>`, `<math>`, `<template>`, `<noscript>`, frames.
- **Inline event handlers stripped.** Every `on*` attribute is removed.
- **`style` attributes stripped** to neutralise the CSS-injection vector.
- **URL attributes validated.** `href`, `src`, `srcset`, `poster`, `cite` go through `isSafeUrl`.
- **External `<a>` hardened.** Auto-applies `rel="noopener noreferrer"` and `target="_blank"`.
- **HTML comments removed.**

### 4. URL validation

`isSafeUrl` accepts only:

- absolute `http:`, `https:`, `mailto:`, `tel:`
- protocol-relative URLs (`//example.com/...`)
- same-origin paths (`/foo`)
- hash / query fragments
- plain relative paths

Everything else — `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`, custom schemes — is rejected. Comparison is case-insensitive and tolerates leading whitespace that some browsers strip before scheme detection.

### 5. CSP integration

Every adapter generates a cryptographic nonce per request via Web Crypto, builds:

- `frame-ancestors 'self' <admin-origins>`
- `script-src 'self' 'nonce-…' 'strict-dynamic' <extras>`

…and merges them into any existing `Content-Security-Policy` header. The CSP-3 `'strict-dynamic'` recipe lets the consumer drop `'unsafe-inline'` entirely.

### 6. Prototype-pollution guard

Nested field lookups (`hero.title`, `hero.__proto__.x`) refuse the keys `__proto__`, `prototype`, `constructor`. The sanitizer never assigns these on parsed nodes.

### 7. No use-after-destroy

`LivePreviewClient` flips an internal `destroyed` flag in its first line of `destroy()`. Every subsequent public method either returns early or throws `LivePreviewClient: already destroyed` — so consumer code cannot race the teardown.

## Disclosing a vulnerability

File a private security advisory at <https://github.com/relative23/payload-live-preview/security/advisories/new>.
