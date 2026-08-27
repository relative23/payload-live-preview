# Security model

The threat model includes **an unauthenticated HTTP requester** and **a
malicious parent window**. Intent-bearing requests and anything that
`postMessage`s the preview page are treated as untrusted until the
corresponding server or browser boundary verifies them.

## Layered defences

### 0. Preview intent is not HTTP authorization

`hasPreviewIntent()` (1.1.0; `isPreviewRequest()` is its deprecated alias)
is an **intent detector**. It checks query parameters,
`Sec-Fetch-Dest: iframe`, and optionally an admin-origin `Referer`. A client
can add a query parameter, cause an iframe navigation, or forge/omit request
headers outside the browser, so a `true` result proves neither identity nor
permission to read a draft.

Since 1.1.0 the package expresses the verification itself.
`authorizePreviewRequest(request, strategy)` turns one of three strategies
into a branded `AuthorizedPreviewContext` — or a refusal with a named
outcome, never an exception:

| Strategy          | What it verifies                                                                                                                 | What it forwards to Payload                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `payload-session` | Exactly one named cookie (default `payload-token`) against `GET /api/<users>/me?depth=0`, bounded timeout, auth-collection check | That one cookie, as `context.payloadHeaders` |
| `signed-token`    | An HMAC-SHA256 token from `issuePreviewToken()` bound to audience, path, locale, purpose, expiry; optional replay store          | Nothing                                      |
| `verifier`        | Your own async function (SSO, custom cookie, edge auth) returning claims or `null`                                               | Whatever the verifier chose                  |

Every adapter accepts that verification as `authorizePreview`. It runs only
on requests with intent, and a refusal blocks **all** response changes the
adapter owns — runtime injection, CSP directives, nonce exposure —
regardless of `autoInject` and `shouldInject`. The same context is what
`createPreviewBindings({ authorization })` and the draft helpers'
`authorization` option consume, so one verdict gates draft selection,
attribute emission, and delivery. The threat model, the token format and
the leakage channels it is designed against are in
[ADR 0006](architecture/0006-authorized-preview-context.md).

The controls keep deliberately narrow responsibilities:

| Control                                         | Responsibility                                                                       | Not a substitute for                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `hasPreviewIntent()` / `previewSignals`         | Detect likely preview intent                                                         | Authentication or authorization                          |
| `authorizePreview` / `AuthorizedPreviewContext` | Verify the request and gate every privileged response change                         | Application caches you own (consume the verdict there)   |
| `allowedOrigins`                                | Constrain browser `postMessage` senders and optionally match a Referer intent signal | HTTP-session authorization                               |
| `shouldInject`                                  | Filter script insertion by route/content                                             | Authorization; it does not suppress adapter CSP handling |
| `draft` / privileged fetch headers              | Select and authenticate a Payload data request                                       | Verifying the frontend request that chose them           |

Without `authorizePreview` the adapters behave as in 1.0 — intent-gated
delivery — for the rest of 1.x, and say so once per process outside
production. `strict: true` refuses to start without the hook, without
explicit `https` admin origins, or with referrer trust; `defaults: 'v2'`
implies it. Both are the 2.0 defaults, available now.

When verification fails or is unavailable, serve the ordinary published
response without privileged headers or preview-specific response changes —
the adapters do exactly that. Bypass application caches and return
`Cache-Control: private, no-store` on authorized responses. Never attach a
long-lived API/service key because an intent signal was present.
`fetchPreviewDocument()` and `fetchPreviewGlobal()` accept the context as
`authorization`; without it their `draft` default remains `true` only for
1.x compatibility, so secure callers pass the verified context.

Signed tokens travel in a query parameter by default, which the browser
history, the `Referer` header, server and CDN logs, and error reporters all
see. The bindings above make a leaked token worth one path on one site for
a few minutes; to shrink that further, prefer the session strategy, send
the token in the `x-preview-token` header where you control the fetch, set
`Referrer-Policy: no-referrer` on preview responses, exclude `previewToken`
from log formats and error-reporter URLs, and supply a replay store.

### 1. Origin allow-list

Inbound `postMessage` events are dropped unless `event.origin` matches one of:

- An explicit origin from `allowedOrigins` (or `PAYLOAD_ADMIN_ORIGIN` env var).
- The captured `document.referrer` origin — **only as a zero-config fallback when no explicit origins are configured**. The referrer names whoever actually framed the page, so it must never widen an explicitly pinned allow-list; the detector enforces this.
- A localhost pattern (`/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i`) — only in development.

After the first accepted data-bearing update, the detector **locks** to that exact origin. Subsequent messages from any other origin (including ones in the original allow-list) are dropped.

⚠️ **Referrer-fallback mode:** when no explicit origins are configured and dev-mode matching is off, the referrer is the only trust source — any site that embeds the preview page in an iframe could then post (sanitised) updates into it. The inline bootstrap logs a console warning in this configuration; programmatic clients can inspect their configuration and provide their own diagnostics. Mitigations: set explicit `allowedOrigins`, and serve a `frame-ancestors` CSP so only the admin may frame the page (the adapters do this by default on intent-matched responses; use the authorization boundary above when that response change is protected).

Note on intent detection and CSP: the adapters treat `Sec-Fetch-Dest: iframe` as an intent signal, so when used directly **any** iframe-destined request gets the merged `frame-ancestors 'self' <admin-origins>` policy. Foreign origins remain blocked from framing; the relaxation versus a site-wide `frame-ancestors 'none'` is that `'self'` and the admin origins become allowed on those responses. For an authorization-gated policy, invoke the adapter middleware only after the application verifier succeeds. Disable with `manageCsp: false` if you need `'none'` unconditionally.

### 2. Message-shape validation

`MessageBus` validates, before routing:

- `event.data` is an object with a string `type`;
- `type` is `payload-live-preview` or `payload-document-event` (unknown types → `onInvalid('type')`);
- for `payload-live-preview`, a full per-type guard runs: `data` must be a plain object when present (a string/array/number `data` is rejected as `onInvalid('shape')`), and each optional scalar (`locale`, `globalSlug`, `previewToken`, `protocolVersion`, …) must have the right primitive type. `null` on these live-preview optional fields is normalized as absent for compatibility with JSON/proxy round trips;
- for `payload-document-event`, the stock bare discriminator is valid, while optional `action`, `slug`, and `id` extensions are checked for their documented string/action or finite string/number shapes.

So the `PayloadLivePreviewMessage.data?: Record<string, unknown>` contract is enforced at runtime, not merely asserted. When an async preview-token validator is configured, verdicts are serialised in message-arrival order so a slower validation cannot let a later update overtake an earlier one.

### 3. HTML sanitisation

Browser/live Lexical output and `html`-typed fields run through a curated DOM
sanitiser. During SSR, `lexicalToHtml()` uses that same backstop only when a DOM
has been supplied with `setSanitizerDocument()`; without one, built-in node
renderers remain escape-by-default, while custom node/block renderers must sanitize
their own HTML:

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

On responses carrying preview intent, adapters merge `frame-ancestors 'self' <admin-origins>` into any existing `Content-Security-Policy` header — as a **union** with the existing directive's sources, never clobbering them (`mergeCspHeader`). Responses without a configured intent signal are left untouched. Intent is not authorization; wrap adapter invocation behind the verified decision described in section 0 when this policy change is protected.

The merge parser follows CSP3 policy parsing at this boundary: directive names and
values are split on CSP ASCII whitespace, directive-name matching uses ASCII-only
case folding, and the first case-insensitive duplicate wins. A later duplicate can
therefore neither relax nor replace the directive a browser actually applies.

Full `script-src` management is opt-in (`manageCsp: 'full'`): a per-request cryptographic nonce (Web Crypto, 128-bit) builds `script-src 'self' 'nonce-…' <extras>`. `'strict-dynamic'` is a further opt-in (`strictDynamic: true`) because under CSP 3 it makes browsers ignore `'self'` and host sources — framework hydration scripts without a nonce would break. Only enable it on fully nonce-disciplined pages.

### 5b. Policed attribute writes

`data-payload-attribute` bindings write remote-controlled values into attributes. The writer refuses event handlers (`on*`), `style`, `srcdoc`, `formaction`, `form`, `id`, `name`, `is`, `srcset`, non-scalar values, and validates `href`/`src`/`poster`/`cite`/`action` through `isSafeUrl`.

### 6. Prototype-pollution guard

Nested field lookups (`hero.title`, `hero.__proto__.x`) refuse the keys `__proto__`, `prototype`, `constructor`. The sanitizer never assigns these on parsed nodes.

### 7. No use-after-destroy

`LivePreviewClient` flips its internal `destroyed` flag before starting any teardown work and publishes one shared teardown Promise before invoking runtime or plugin callbacks. Concurrent and re-entrant `destroy()` calls therefore observe the same completion. `start()` and `use()` cannot re-arm a destroyed client, cache refresh becomes inert with the stopped runtime, and late `unuse()` calls can only participate in removing already-owned plugin resources.

### 8. Maintainer install policy

The repository pins its maintainer package manager through `packageManager` and CI
installs that exact npm release before a clean install. `strict-allow-scripts=true`
makes an unreviewed dependency install script a hard failure. The allow-list permits
only the pinned `esbuild` binary installer; optional `fsevents` install scripts are
explicitly denied because they are not needed on the supported CI platforms.

The root CI runs `npm audit --audit-level=high`. A narrow `tsup` override keeps its
private build-time `esbuild` copy on the reviewed patched version until `tsup`'s own
range includes it. These are maintainer-tooling controls: the published package has
no mandatory runtime dependency, so root development advisories must not be presented
as consumer runtime dependencies.

The published manifest is install-script-free: it exposes no `preinstall`,
`install`, `postinstall`, or `prepare` hook. CI builds the single-source runtime
explicitly, then installs the exact tarball without `--ignore-scripts` under
`strict-allow-scripts=true` and independently rejects any forbidden lifecycle key
in the installed packed manifest. Package consumers are created outside the repository
tree: runtime exports are tested without optional peers, and a separate codegen
consumer explicitly installs the reviewed `ts-morph` peer. Maintainer `node_modules`
therefore cannot hide an undeclared package dependency. Consumers receive reviewed
build output without approving or possessing this repository's maintainer build
toolchain.

Each real-app fixture has the same strict policy and approves only the exact registry
binary installers present in that fixture's lockfile. CI builds the root package
first and the local `file:../..` fixtures consume that reviewed `dist` copy; the
package itself has no install hook to approve. An install performed without that
root build is intentionally not a complete runnable fixture setup.

The private real-Payload fixture currently retains five moderate
advisories in Payload's pinned SQLite tooling chain
(`drizzle-kit` → deprecated esbuild-kit loader → `esbuild@0.18.20`). The vulnerable
esbuild development-server API is not invoked: the fixture binds its test servers to
localhost and exists only in maintainer E2E, while none of these packages ships in the
published tarball. There is no compatible upstream fix as of 2026-08-13; review this
exception at the next Payload update and no later than 2026-11-13. Do not force an
unsupported transitive override through Payload's database tooling merely to make the
audit count zero.

## Disclosing a vulnerability

File a private security advisory at <https://github.com/relative23/payload-live-preview/security/advisories/new>.
