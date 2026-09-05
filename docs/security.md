# Security model

The threat model includes **an unauthenticated HTTP requester** and **a
malicious parent window**. Intent-bearing requests and anything that
`postMessage`s the preview page are treated as untrusted until the
corresponding server or browser boundary verifies them.

## Preview intent is not HTTP authorization

`hasPreviewIntent()` is an **intent detector**. It checks query parameters
(`preview`, `draft`, `livePreview`, value `true` or `1`) and, when enabled
through `previewSignals`, `Sec-Fetch-Dest: iframe` and an admin-origin
`Referer`. A client can add a query parameter, cause an iframe navigation, or
forge/omit request headers outside the browser, so a `true` result proves
neither identity nor permission to read a draft.

`authorizePreviewRequest(request, strategy)` turns one of three strategies
into a branded `AuthorizedPreviewContext` — or a refusal with a named
outcome. It throws only a `PreviewConfigurationError` (a short secret, a
malformed cookie name, a relative `serverURL`), which the adapters re-throw
rather than report as `unavailable`, so a misconfigured deployment fails on
the first preview request instead of serving public pages quietly:

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
`authorization` option consume, so one authorization gates draft selection,
attribute emission, and delivery. The threat model, the token format and
the leakage channels it is designed against are in
[ADR 0006 — Authorized preview context](architecture/0006-authorized-preview-context.md).

The controls keep deliberately narrow responsibilities:

| Control                                         | Responsibility                                                                       | Not a substitute for                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `hasPreviewIntent()` / `previewSignals`         | Detect likely preview intent                                                         | Authentication or authorization                              |
| `authorizePreview` / `AuthorizedPreviewContext` | Verify the request and gate every privileged response change                         | Application caches you own (consume the authorization there) |
| `allowedOrigins`                                | Constrain browser `postMessage` senders and optionally match a Referer intent signal | HTTP-session authorization                                   |
| `shouldInject`                                  | Filter script insertion by route/content                                             | Authorization; it does not suppress adapter CSP handling     |
| `draft` / privileged fetch headers              | Select and authenticate a Payload data request                                       | Verifying the frontend request that chose them               |

`strict` is the default: an adapter refuses to start without
`authorizePreview`, without explicit `https` admin origins (outside
development), or with referrer trust — including the trust the `'v1'` signal
set implies. `defaults: 'v1'` restores the 1.x intent-only behavior, with a
one-time development warning, for a staged migration.

When verification fails or is unavailable the adapters serve the ordinary
published response unchanged. A response an adapter did change — runtime
injected or CSP merged — is sent with `Cache-Control: private, no-store` and
`Vary: Cookie`, so a preview is never stored as the public page; your own
page cache should consume the same authorization. Astro, SvelteKit and Nuxt
publish the authorization as `livePreviewAuthorization` and the hook's
outcome as `livePreviewAuthorizationOutcome` on `locals` / `event.context`
(Nuxt: from `defineLivePreviewServerHandler()`, before the app renders);
Next.js middleware has no locals, so call `authorizePreviewRequest()` in the
route when the page needs the authorization. Never attach a long-lived
API/service key because an intent signal was present. `definePreview()` on
`payload-live-preview/server` takes the context as its required
`authorization` and reads a draft only with a real one.

Signed tokens travel in a query parameter by default, which the browser
history, the `Referer` header, server and CDN logs, and error reporters all
see. The bindings above make a leaked token worth one path on one site for
a few minutes; to shrink that further, prefer the session strategy, send
the token in the `x-preview-token` header where you control the fetch, set
`Referrer-Policy: no-referrer` on preview responses, exclude `previewToken`
from log formats and error-reporter URLs, and supply a replay store.

## Origin allow-list

Inbound `postMessage` events are dropped unless `event.origin` matches one of:

- An explicit origin from `allowedOrigins`. The browser runtime reads no
  environment variable — read `PUBLIC_PAYLOAD_ADMIN_ORIGIN` on the server and
  pass the value in.
- The captured `document.referrer` origin — **only as a zero-config fallback when no explicit origins are configured**, and only with `disableReferrerDetection: false` (`defaults: 'v1'`). The referrer names whoever actually framed the page, so it must never widen an explicitly pinned allow-list; the detector enforces this.
- A localhost pattern (`/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i`) — only in development.

After the first accepted data-bearing update, the detector **locks** to that exact origin. Subsequent messages from any other origin (including ones in the original allow-list) are dropped.

⚠️ **Referrer-fallback mode:** when no explicit origins are configured, referrer detection is on and dev-mode matching is off, the referrer is the only trust source — any site that embeds the preview page in an iframe could then post (sanitized) updates into it. The inline bootstrap logs a console warning (`LP0102`) in this configuration; programmatic clients can inspect their configuration and provide their own diagnostics. Mitigations: set explicit `allowedOrigins`, and serve a `frame-ancestors` CSP so only the admin may frame the page (the adapters do this by default on intent-matched responses; use the authorization boundary above when that response change is protected).

Note on intent detection and CSP: under the default `previewSignals: ['query']` only `?preview=true` (or a configured parameter) counts as intent; with `defaults: 'v1'` an iframe destination and an admin referer count too, so **any** iframe-destined request then gets the merged `frame-ancestors 'self' <admin-origins>` policy. Foreign origins remain blocked from framing; the relaxation versus a site-wide `frame-ancestors 'none'` is that `'self'` and the admin origins become allowed on those responses — and only after `authorizePreview` accepted the request under `strict`. Disable with `manageCsp: false` if you need `'none'` unconditionally.

## Message-shape validation

`MessageBus` validates, before routing:

- `event.data` is an object with a string `type`;
- `type` is `payload-live-preview` or `payload-document-event` (unknown types → `onInvalid('type')`);
- for `payload-live-preview`, a full per-type guard runs: `data` must be a plain object when present (a string/array/number `data` is rejected as `onInvalid('shape')`), and each optional scalar (`locale`, `globalSlug`, `previewToken`, `protocolVersion`, …) must have the right primitive type. `null` on these live-preview optional fields is normalized as absent for compatibility with JSON/proxy round trips;
- for `payload-document-event`, the stock bare discriminator is valid, while optional `action`, `slug`, and `id` extensions are checked for their documented string/action or finite string/number shapes.

So the `PayloadLivePreviewMessage.data?: Record<string, unknown>` contract is enforced at runtime, not merely asserted. When an async preview-token validator is configured, its results are serialized in message-arrival order so a slower validation cannot let a later update overtake an earlier one. Under the default `eventSourcePolicy: 'parent-or-opener'` only the parent or opener window may post at all.

## HTML sanitization

Browser/live Lexical output and `html`-typed fields run through a curated DOM
sanitizer. During SSR, `lexicalToHtml()` uses that same backstop only when a DOM
has been supplied with `setSanitizerDocument()`; without one, built-in node
renderers remain escape-by-default, while custom node/block renderers must sanitize
their own HTML:

- **Allow-listed tags only.** Removes `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<form>` and every form control, `<svg>`, `<math>`, `<template>`, `<noscript>`, frames.
- **Inline event handlers stripped.** Every `on*` attribute is removed.
- **`style` attributes stripped** to neutralize the CSS-injection vector.
- **URL attributes validated.** `href`, `src`, `srcset`, `poster`, `cite` go through `isSafeUrl`.
- **External `<a>` hardened.** Auto-applies `rel="noopener noreferrer"` and `target="_blank"`.
- **HTML comments removed.**

**Policies.** `sanitizerPolicy: 'strict'` is the default everywhere — the
browser runtime, `sanitizeHtml()` and SSR `lexicalToHtml()`: it strips `id`
and `name` (DOM clobbering, below), strips `data-payload-*` (rich text must
never add a binding), and passes other `data-*` only when listed in
`allowedDataAttributes`. Those checks run before the extension allow-lists,
so `additionalAllowedAttributes` cannot re-admit them. `'compat'`
(`defaults: 'v1'`, or `setSanitizerPolicy('compat')`) keeps `id` and every
`data-*`. Every sanitizer case in the property suite runs under both
policies. Item templates for structural lists are the one place form
controls are admitted (`allowFormControls`) and the applier's own
reconciliation attributes survive strict (`templateMode`: `id`, `name`,
`data-payload-key`, `data-payload-nested-key`,
`data-payload-nested-template` — every other `data-payload-*` is still
stripped, so a template cannot add a binding), because they are the page
author's markup and every interpolated value is escaped first.

**Trusted Types.** Every HTML sink — the sanitizer's own parse and the
rich-text, html, array, upload, text and structural writes — goes through
one policy named `payload-live-preview`, created on first use where the
API exists. A site enforcing `require-trusted-types-for 'script'` lists
that name in its `trusted-types` directive, or hands its own policy to
`setTrustedTypesPolicy()`.

## URL validation

`isSafeUrl` accepts only:

- absolute `http:`, `https:`, `mailto:`, `tel:`
- protocol-relative URLs (`//example.com/...`)
- same-origin paths (`/foo`)
- hash / query fragments
- plain relative paths

Everything else — `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`, custom schemes — is rejected. Comparison is case-insensitive; tabs and newlines are removed and leading whitespace is trimmed first, as the URL parser does. Backslash forms the parser resolves to another origin (`/\evil.com`, `\\evil.com`) count as protocol-relative, so `isExternalHttpUrl()` reports them external and the sanitizer hardens such links with `noopener`.

## CSP integration

On authorized preview responses (intent, then `authorizePreview`), adapters merge `frame-ancestors 'self' <admin-origins>` into any existing `Content-Security-Policy` header — as a **union** with the existing directive's sources, never clobbering them (`mergeCspHeader`). A header value carrying several policies (`Headers.get()` joins repeated headers with `, `; Node hands them over as an array) has the directive merged into every policy, because a browser enforces all of them and widening only one would leave the others blocking the admin. Responses without intent, or refused, are left untouched.

The merge parser follows CSP3 policy parsing at this boundary: directive names and
values are split on CSP ASCII whitespace, directive-name matching uses ASCII-only
case folding, and the first case-insensitive duplicate wins. A later duplicate can
therefore neither relax nor replace the directive a browser actually applies.

Full `script-src` management is opt-in (`manageCsp: 'full'`): a per-request cryptographic nonce (Web Crypto, 128-bit) builds `script-src 'self' 'nonce-…' <extras>`. `'strict-dynamic'` is a further opt-in (`strictDynamic: true`) because under CSP 3 it makes browsers ignore `'self'` and host sources — framework hydration scripts without a nonce would break. Only enable it on fully nonce-disciplined pages.

## Policed attribute writes

`data-payload-attribute` bindings write remote-controlled values into attributes. The writer refuses event handlers (`on*`), `style`, `srcdoc`, `formaction`, `form`, `id`, `name`, `is`, `srcset`, non-scalar values, and validates `href`/`src`/`poster`/`cite`/`action` through `isSafeUrl`. A refused write is reported as `LP0401`.

## DOM clobbering through sanitized `id`, `name` and `data-*`

The strict default drops `id`, `name` and every `data-payload-*` attribute
from sanitized output and passes other `data-*` only by explicit list; the
decision is recorded in
[ADR 0007 — 2.0 defaults, migration policy, and the renames ledger](architecture/0007-v2-defaults-and-renames-ledger.md).
The `'compat'` policy keeps `id` and every `data-*`. This is the threat model
behind that difference.

**Who can author the input.** Rich text comes from the Payload editor, so
the author is an editor — someone the site already trusts with its content
— or an attacker who has taken over an editor's session, or a field whose
value is user-generated and rendered through `lexicalToHtml()` by the
application. The third case is the one that matters: the sanitizer promises
that arbitrary Lexical JSON produces no executable content; it does not
promise the output is inert to the page's own scripts.

**What `id` and `name` can do.** Browsers expose elements with an `id` as
properties of `window` and elements with a `name` as properties of
`document` and of their `<form>`. A rendered `<a id="config">` shadows a
global `config` a page script reads without declaring it; a rendered
`<img name="body">` (were `name` allowed) would shadow `document.body`. The
runtime itself is not clobberable this way: `window.__livePreview` is
assigned by the runtime before any content it renders, and every internal
reference is a module binding, never a global lookup. The exposure is the
application's own scripts, and only those that read undeclared globals.

**What `data-*` can do — the one that matters here.** The runtime binds by
attribute: an element carrying `data-payload-field="price"` is a binding,
wherever it came from. Rich text that renders `<span data-payload-field="price">`
inside a bound `body` field therefore creates a nested binding the runtime
will patch on the next update, and `data-payload-owner` on such an element
would claim a document. With owner scoping on, a claimed owner that is not
the selected document is out of scope and never patched; without it, the
injected binding receives the field's value like any other. The effect is
content-only — the runtime writes text through the same sanitized
renderers — so this is an integrity nuisance an editor could inflict on
their own page, not an escalation. It is still a binding the author of the
page did not write.

**Residual controls under `'compat'`.** Keep rich-text output out of
`id`-sensitive scripts — declare every global a page script reads. Run with
`scopeBindingsByOwner` so a claimed owner cannot reach into another
document. Treat user-generated Lexical as untrusted for a different reason
than XSS: it can add bindings.

## Prototype-pollution guard

Nested field lookups (`hero.title`, `hero.__proto__.x`) refuse the keys `__proto__`, `prototype`, `constructor`. The sanitizer never assigns these on parsed nodes.

## No use-after-destroy

`LivePreviewClient` flips its internal `destroyed` flag before starting any teardown work and publishes one shared teardown Promise before invoking runtime or plugin callbacks. Concurrent and re-entrant `destroy()` calls therefore observe the same completion. `start()` and `use()` cannot re-arm a destroyed client, cache refresh becomes inert with the stopped runtime, and late `unuse()` calls can only participate in removing already-owned plugin resources.

## Maintainer controls

The install-script policy, the `npm audit` policy and its exception register
for the repository's own toolchain are maintainer matters, described under
[Dependency policy in CONTRIBUTING.md](../CONTRIBUTING.md#dependency-policy).
The published package has no mandatory runtime dependency and no install
hook.

## Disclosing a vulnerability

File a private security advisory at <https://github.com/relative23/payload-live-preview/security/advisories/new>.
