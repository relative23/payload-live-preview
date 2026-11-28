# Threat model

Applies to payload-live-preview 3.0.

This page names what the package protects, from whom, and which control
answers which threat. It adds no control and no reasoning of its own: the rows
are taken from the records they link, where each one is argued and where its
limits are written down. It is revised with every release that moves a
boundary, and the revisions are listed at the end.

## What is protected

1. **Draft content.** Unpublished documents, including ones that will never be
   published. Reading a draft is the primary privilege.
2. **The content model.** `data-payload-field`, `data-payload-owner` and their
   companion attributes name collections, globals, field paths and document
   ids. On a public response they map the schema for free.
3. **The script execution context.** Injecting the runtime and adding a nonce
   to `script-src` widens what may execute on the page, and a relaxed
   `frame-ancestors` lets the page be framed.
4. **Cache integrity.** A preview response must never be stored as the public
   response, and a public response must never be served to an editor as a
   preview.
5. **The editor's session.** Whatever proves authorization, a Payload session
   cookie or a signed token, is itself an asset once it leaves the admin.
6. **The page an editor looks at.** What the runtime writes into the DOM comes
   from another window and from the content of a field.

The first five are the assets of
[ADR 0006](architecture/0006-authorized-preview-context.md#assets); the sixth
is what [security.md](security.md) defends in the browser.

## Who attacks

- **A1, an anonymous visitor.** Controls the URL and every request header,
  including `Referer` and `Sec-Fetch-Dest`, and can embed the site in an iframe
  on a page they own. Cannot read the editor's cookies.
- **A2, a passive observer of URLs.** Sees query strings through the `Referer`
  header on outbound links, server and CDN access logs, browser history and
  sync, error reporters that capture the page URL, and shared screenshots.
- **A3, a replaying party.** Obtains a previously valid credential, through A2
  or a leaked preview link, and presents it later or elsewhere.
- **A4, a hostile embedding page.** Frames the site or opens it as a popup and
  posts messages into it.
- **A5, an editor of another document.** Holds a valid authorization for
  document A and asks for document B.
- **A6, an author of content.** An editor, someone who took over an editor's
  session, or a visitor whose input the application renders through
  `lexicalToHtml()`.

Out of scope: a compromised admin origin, a compromised editor browser and a
compromised application server. Each of those already holds the assets.

## The response to a request

A1 to A3 against assets 1 to 5. The reasoning is in
[ADR 0006](architecture/0006-authorized-preview-context.md) and
[authorization.md](authorization.md).

| Threat                                                                                 | Control                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A request is made to look like a preview and gets a draft, the bindings or the runtime | Intent is a query parameter by default (`previewSignals: ['query']`) and proves nothing. Every response change an adapter owns waits for `authorizePreview`, and a refusal blocks all of them: injection, CSP directives and the nonce |
| Something else stands in for the verdict                                               | `authorizePreviewRequest()` returns a branded context or a refusal with a named outcome. A context is the object the package made; a copy is refused wherever a context is read                                                        |
| A credential read off a URL is used later or elsewhere                                 | A signed token is bound to audience, path, locale, purpose and expiry. Within its lifetime and on its own path it is accepted again unless the application supplies a replay store                                                     |
| The editor's cookie reaches the wrong place                                            | `payload-session` forwards exactly one named cookie to `GET /api/<users>/me?depth=0`, with a bounded timeout, without following a redirect, and checks the auth collection                                                             |
| A misconfigured deployment serves public pages quietly                                 | A short secret, a malformed cookie name or a relative `serverURL` throws `PreviewConfigurationError`, which the adapters re-throw: the first preview request fails                                                                     |
| The page is framed by whoever can make a request look like a preview                   | `frame-ancestors 'self' <admin origins>` is merged only into an authorized preview response, as a union with the directive that is there; of duplicate directives the first wins, as in a browser                                      |
| One authorization gates one thing and another is forgotten                             | The same context is what `createPreviewBindings({ authorization })` and the draft helpers consume, so one verdict gates draft selection, attribute emission and delivery                                                               |

The channels a token leaks through, and what limits each, are the table in
[ADR 0006 §4](architecture/0006-authorized-preview-context.md#4-leakage-channels-and-the-controls-the-token-must-survive).

## The fragment endpoint

A1, A3 and A5 against assets 1 and 4, and against the server's own resources.
The table is the abuse model of
[ADR 0011 §4](architecture/0011-fragment-protocol-and-abuse-model.md#4-abuse-model--and-where-each-control-is-verified),
which also says where each control is verified.

| Threat                                                | Control                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSR injection: the request chooses what runs          | Registry lookup by id only, own properties, prototype names refused; props are computed on the server; no path, template or code crosses the wire                            |
| Confused deputy: the site renders for a non-editor    | `authorizePreviewRequest()` with the site's strategy on the page route and query the client reports, under the request's own cookies and headers                             |
| Token leakage                                         | The token travels only as it already does for the page; responses are `no-store`; a refusal carries no detail                                                                |
| Cross-site request forgery                            | `Sec-Fetch-Site` must be `same-origin` or `none`; `Origin` must match the page origin or an explicit allow-list; a JSON content type is required                             |
| Amplification and resource exhaustion                 | A streamed body limit of 64 KiB, a field depth limit, one deadline for the body read and separate ones for props and render, and a concurrency cap with dedupe in the client |
| Cross-tenant access: a token for document A renders B | The exact locale when scoped; opt-in `scope.payload` also binds document kind, slug and id before props and render, with expiry and any site audience or path                |
| Stale content shown as current                        | Requests are bound to a revision and aborted when it is superseded; a failure falls back to the patch and shows an `LP08xx` code                                             |

## Messages into the page, and what is written to it

A4 and A6 against asset 6. The reasoning is in [security.md](security.md).

| Threat                                             | Control                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A foreign window posts updates                     | A message is dropped unless its origin is in `allowedOrigins`; the referrer counts only with `enableReferrerDetection: true` and no explicit origin, a localhost pattern only in development. By default the sender must be the parent or opener (`eventSourcePolicy`) |
| A message of an unknown or malformed shape         | `MessageBus` validates the type and a guard per type before it routes anything                                                                                                                                                                                         |
| Markup in a field executes                         | Lexical output and `html` fields pass a curated DOM sanitizer; `lexicalToHtml()` throws without a DOM instead of returning markup it could not sanitize                                                                                                                |
| A URL in content runs script                       | `isSafeUrl` accepts `http:`, `https:`, `mailto:`, `tel:`, protocol-relative, same-origin, hash, query and relative forms, and nothing else                                                                                                                             |
| A remote value lands in an attribute that executes | The attribute writer refuses event handlers, `style`, `srcdoc`, `formaction` and the other attributes its section lists, and non-scalar values                                                                                                                         |
| Rendered markup shadows a global or adds a binding | The strict sanitizer policy, the default, drops `id`, `name` and every `data-payload-*` attribute; with `scopeBindingsByOwner` a claimed owner cannot reach into another document                                                                                      |
| A field path reaches a prototype                   | Nested lookups refuse `__proto__`, `prototype` and `constructor`                                                                                                                                                                                                       |

## What stays with the deployment

- **Replay within a token's lifetime on its own path** is accepted unless the
  application supplies a replay store. The session strategy has no such
  residual, since it forwards a cookie the browser scopes.
- **Where a token-bearing URL is written down.** A referrer policy on preview
  responses, and access logs and error reporters that leave the token parameter
  out, are the deployment's to set.
- **A cache in front of the site.** A preview answer says
  `Cache-Control: private, no-store` and `Vary: Cookie`, and a cache has to
  honour both. It also has to keep the query in its key or to bypass the intent
  parameters: the answer to a refused request keeps the application's headers,
  and a cache that stored it would hand the admin the public page
  ([deployment.md](deployment.md#preview-responses-and-caches)).
- **Rate limits, wire-size and decompression limits, and a hard limit on
  execution** at the fragment endpoint. Its timers cannot interrupt synchronous
  component code.
- **The `'compat'` sanitizer policy** keeps `id` and every `data-*`: a page
  under it declares every global its scripts read, and treats user-generated
  rich text as something that can add bindings.

## Revisions

- **3.0.** The first version of this page. Merged from ADR 0006 (assets,
  adversaries, the response decision, the leakage channels), ADR 0011 (the
  abuse model of the fragment endpoint) and security.md (message ingress and
  writes to the page). Since 3.0 no response changes on intent alone, a
  context cannot be copied, and `lexicalToHtml()` requires a document.
