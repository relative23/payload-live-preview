# Security model

The threat model is **a malicious parent window**: anything that postMessages the preview page is treated as untrusted until verified.

## Layered defences

### 1. Origin allow-list

Inbound `postMessage` events are dropped unless `event.origin` matches one of:

- An explicit origin from `allowedOrigins` (or `PAYLOAD_ADMIN_ORIGIN` env var).
- The captured `document.referrer` origin — **only as a zero-config fallback when no explicit origins are configured**. The referrer names whoever actually framed the page, so it must never widen an explicitly pinned allow-list; the detector enforces this.
- A localhost pattern (`/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i`) — only in development.

After the first valid update, the detector **locks** to that exact origin. Subsequent messages from any other origin (including ones in the original allow-list) are dropped.

⚠️ **Referrer-fallback mode:** when no explicit origins are configured and dev-mode matching is off, the referrer is the only trust source — any site that embeds the preview page in an iframe could then post (sanitised) updates into it. The runtime logs a console warning in this configuration. Mitigations: set explicit `allowedOrigins`, and serve a `frame-ancestors` CSP so only the admin may frame the page (the adapters do this by default on preview responses).

Note on preview detection and CSP: the adapters treat `Sec-Fetch-Dest: iframe` as a preview signal, so **any** iframe-destined request gets the merged `frame-ancestors 'self' <admin-origins>` policy. Foreign origins remain blocked from framing; the only relaxation versus a site-wide `frame-ancestors 'none'` is that `'self'` and the admin origins become allowed on those responses. Disable with `manageCsp: false` if you need `'none'` unconditionally.

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

On preview responses, adapters merge `frame-ancestors 'self' <admin-origins>` into any existing `Content-Security-Policy` header — as a **union** with the existing directive's sources, never clobbering them (`mergeCspHeader`). Non-preview responses are left untouched.

Full `script-src` management is opt-in (`manageCsp: 'full'`): a per-request cryptographic nonce (Web Crypto, 128-bit) builds `script-src 'self' 'nonce-…' <extras>`. `'strict-dynamic'` is a further opt-in (`strictDynamic: true`) because under CSP 3 it makes browsers ignore `'self'` and host sources — framework hydration scripts without a nonce would break. Only enable it on fully nonce-disciplined pages.

### 5b. Policed attribute writes

`data-payload-attribute` bindings write remote-controlled values into attributes. The writer refuses event handlers (`on*`), `style`, `srcdoc`, `formaction`, `form`, `id`, `name`, `is`, `srcset`, non-scalar values, and validates `href`/`src`/`poster`/`cite`/`action` through `isSafeUrl`.

### 6. Prototype-pollution guard

Nested field lookups (`hero.title`, `hero.__proto__.x`) refuse the keys `__proto__`, `prototype`, `constructor`. The sanitizer never assigns these on parsed nodes.

### 7. No use-after-destroy

`LivePreviewClient` flips an internal `destroyed` flag in its first line of `destroy()`. Every subsequent public method either returns early or throws `LivePreviewClient: already destroyed` — so consumer code cannot race the teardown.

## Disclosing a vulnerability

File a private security advisory at <https://github.com/relative23/payload-live-preview/security/advisories/new>.
