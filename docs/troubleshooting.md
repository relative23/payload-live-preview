# Troubleshooting

Start with the symptom. Each one names the `inspect()` reading that settles it
and the diagnostic code to expect. The readings are explained under
[Inspecting a running preview](#inspecting-a-running-preview), the deployment
audit under [Auditing a deployment](#auditing-a-deployment-pll-doctor), and
every code under [Diagnostic codes](#diagnostic-codes).

## Symptoms

### Nothing updates

1. Open the browser console **inside the preview iframe** and run
   `__livePreview.inspect()`. If the handle does not exist, the runtime is not
   on the page: the adapter saw no preview intent (the URL needs
   `?preview=true`; `draft` and `livePreview` count too), the response came
   from a cache, or the page is not framed by the admin at all. `pll doctor`
   tells these apart.
2. `status` is `disconnected` and `revisions.accepted` is `0`: no message was
   accepted. `origins.trusted` must contain the admin origin exactly —
   `PUBLIC_PAYLOAD_ADMIN_ORIGIN` with scheme and port. `debug: true` logs each
   refusal as `LP0501` with its reason; `LP0101` means no origin is configured
   at all.
3. `revisions.accepted` grows but the page does not change: read
   `bindings.orphanFields`. A name there arrived but matched no element
   (`LP0201`) — usually a binding rendered only while the field is non-empty.
   A name in neither `orphanFields` nor `fieldNames` was never sent.
   `bindings.absentFields` is the opposite case: the element exists, the update
   carried no value for it.
4. `bindings.ownerScoped` is `true`: an element outside every
   `data-payload-owner` receives nothing, and a message that names no document
   is dropped (`LP0202`).

### IDs instead of content

Payload 3.x posts raw form values, so relationship and upload fields arrive as
bare IDs. Set `serverURL` (`PAYLOAD_URL`) together with the `mergeDepth` your
page query uses; the runtime then re-fetches each update through the REST API
with credentials. `protocol.profile` says which Payload is on the wire:
`payload-2` populates on the admin side and needs no merge. A failed merge
falls back to the raw values and logs the HTTP status under `debug: true`. When
the site and Payload are on different domains, that request needs CORS with
credentials — see [deployment.md](deployment.md).

### The iframe does not load

The admin shows an empty frame or a browser error page. Run the audit:

```
npx pll doctor https://www.example.com/page --admin https://cms.example.com
```

`LP0703` means `X-Frame-Options` forbids framing — a header no CSP can
override, usually set by a proxy or a security middleware. `LP0702` means
`frame-ancestors` does not admit the admin origin: add it to `allowedOrigins`
so the adapter merges it, or to your own policy. A frame that shows a server
error instead points at `strict`: an adapter refuses to start without
`authorizePreview`, without explicit `https:` origins outside development, or
with referrer trust, and the error names the option.

### Nothing below the fold updates

Above `visibilityGateThreshold` (default 50 bindings) the scheduler holds
writes for offscreen elements until they scroll into view. `inspect()` shows
`scheduler.visibilityGateActive: true` and a growing `scheduler.deferred`; the
console says `LP0301`. Raise the threshold, set `disableVisibilityGate`, or
accept the deferral. `pll doctor` reports the same page as `LP0705` before an
editor notices.

### Works locally, not deployed

Development forgives what production refuses:

- The localhost matcher accepts any `localhost` port; deployed, only
  `allowedOrigins` counts. `origins.trusted` must hold the deployed admin origin.
- `strict` accepts `http:` admin origins only while `NODE_ENV` is not
  `production`.
- A proxy or CDN may strip `Sec-Fetch-Dest`, the CSP header or the cache
  headers, or hand the admin a cached public page. `pll doctor` fetches the URL
  as a visitor and as the admin's iframe and reports the difference: `LP0701`
  (no runtime in the preview response), `LP0702`, `LP0703`, `LP0710` (runtime
  on the public page).
- Cookies do not cross domains. An admin on another domain than the site needs
  the signed-token strategy; see [deployment.md](deployment.md).
- A host that rewrites JavaScript breaks the loader asset's integrity check
  (Astro `mode: 'loader'`); the runtime is then not loaded and not retried.

### Updates, but focus jumps

A list item keeps its element — and the focus, selection and typed value in
it — only when it carries a stable key. `LP0404` (no `id`), `LP0405`
(duplicate keys) and `LP0406` (keys that change every message) each degrade to
positional pairing, and a re-rendered item loses what the visitor had in it.
Give items a stable `id` or `data-payload-key`. A hydrated island that
re-renders its subtree overwrites a live patch; mark it `data-payload-island`
so the runtime leaves it alone ([interop.md](interop.md)). With
`revealEditedField` on, the preview scrolls to the edited field on purpose,
and only while it is offscreen.

## Inspecting a running preview

`inspect()` returns a point-in-time snapshot of what the runtime sees. It
performs no I/O and transmits nothing. Adapter users reach it on the global
handle inside the preview iframe:

```js
// In the browser console, inside the preview iframe
__livePreview.inspect();
```

Consumers driving the runtime themselves call it on the client:

```ts
const client = initLivePreview({ allowedOrigins: ['https://cms.example.com'] });
console.log(client.inspect());
```

| Reading                                                    | What it tells you                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bindings.orphanFields`                                    | Field names that arrived but matched no element. A name here is a markup problem; a name in neither this nor `bindings.fieldNames` was never sent.                                                                                                                                                        |
| `bindings.absentFields`                                    | Bound fields some update carried no value for, so the binding kept its old text.                                                                                                                                                                                                                          |
| `scheduler.deferred` with `scheduler.visibilityGateActive` | Updates the visibility gate is holding until the element scrolls into view. On a page nobody scrolls, that is "never" — the symptom is a preview that stops updating below the fold.                                                                                                                      |
| `revisions.superseded`                                     | Updates abandoned because a newer one arrived. Tracking `accepted` closely is normal for fast typing; it only matters when the _last_ update is among them.                                                                                                                                               |
| `revisions.completed`                                      | Updates whose flush ran — their writes reached the DOM, or there was nothing to write. `accepted − superseded − completed` is in flight or cancelled.                                                                                                                                                     |
| `revisions.skippedUnchanged`                               | Bindings not written because their value equaled the one last applied (`skipUnchanged`). A large number beside a small `accepted` is the optimization working.                                                                                                                                            |
| `origins.trusted`, `origins.locked`                        | The configured origins, and the one the runtime locked onto after its first accepted update. Every other origin is refused from then on.                                                                                                                                                                  |
| `bindings.ownerScoped` with `bindings.owners`              | Whether owner scoping is on, and which documents the page declares. Under scoping, an unowned binding receives nothing.                                                                                                                                                                                   |
| `protocol.negotiated`                                      | The version both sides share, which caps the capabilities in `protocol.capabilities`.                                                                                                                                                                                                                     |
| `protocol.observed`                                        | Capabilities seen on the wire rather than granted by version — the stock admin announces no version, so this is how its abilities become known (`locale`, `schema-json`, `document-events`, `relationship-events`, `preview-token`). Each capability declares a fallback; see `CAPABILITY_DOCUMENTATION`. |
| `protocol.profile`                                         | What the observed capabilities imply: `payload-2` (a schema on the wire; the admin populates relationships itself, so no REST merge), `payload-3` (document or relationship events seen), or `unknown` (treated like 3.x for merging).                                                                    |
| `scheduler.lastFlush.appliedFields`                        | The field names the most recent flush wrote, in order — a count alone cannot say a binding was skipped.                                                                                                                                                                                                   |
| `fragments`                                                | Server-rendered boundaries: `handler` (a fragment client is configured), `inFlight`, `rendered`, `failed`, `superseded`.                                                                                                                                                                                  |
| `route`                                                    | Route refreshes: `handler`, `refreshes`, `failed`, `loopStopped` (second requests for one revision, refused with `LP0805`).                                                                                                                                                                               |

The snapshot is available in production builds. It discloses nothing that is
not already on the page — the trusted origins are inside the injected script
and the field names are `data-payload-field` attributes in the DOM — and a
preview that misbehaves only on the deployed site is exactly the case where
the information is worth having.

## Auditing a deployment: `pll doctor`

`inspect()` answers "what is this runtime doing right now" from inside the
page. `pll doctor` answers the question one step earlier: what does this
deployment serve?

```
npx pll doctor https://www.example.com/page --admin https://cms.example.com
npx pll doctor https://www.example.com/page --admin https://cms.example.com --json
npx pll doctor https://www.example.com/page --v2
```

It fetches the URL twice — once as an ordinary visitor, once with the headers
the admin's iframe sends — and reports the difference. That comparison is the
point: a config can say `allowedOrigins: [...]` while a proxy strips the
header, an adapter runs in a mode nobody remembers choosing, or a build emits
binding attributes on public pages. Redirects are reported, not followed, so
probe the final URL.

`--admin <origin>` enables the `frame-ancestors` check to verify that the
origin is admitted, not merely that a policy exists. `--json` emits the report
as data. `--v2` also reads the served inline configuration and reports every
runtime row still at its `defaults: 'v1'` value as `LP0709` (referrer trust,
message source, sanitizer policy, `skipUnchanged`). The findings are
`LP0701`–`LP0710` in the table below.

The two probes differ only in their headers (`Sec-Fetch-Dest: iframe` and an
admin `Referer` on the second); the URL is fetched as given. Under the default
`previewSignals: ['query']` and `strict`, neither probe carries a query signal
or a credential, so an adapter injects nothing into either and `LP0701` is
expected on a correctly configured deployment — the framing, header and
binding checks are what the audit adds there. A URL that carries
`?preview=true` and a valid token turns both probes into preview requests: the
runtime and binding findings then describe the authorized response, not what
a visitor sees.

Exit codes: `0` no error-level findings, `1` usage error or the URL could not
be fetched, `2` at least one error-level finding — so it drops into CI as a
smoke test against a deploy preview.

The audit makes exactly the two requests it is told to make, sends no
credentials, and reports no telemetry. `analyzeProbe()` is exported from
`payload-live-preview/doctor` for callers who fetch the responses themselves.

## Diagnostic codes

Every message the runtime and the tools report carries a stable code. Prose
gets reworded; a code does not — so a log filter, an alert rule, or a bug
report that names `LP0301` still means the same thing after the sentence
around it changes. Codes are never reused for a different meaning and never
renumbered.

<!-- diagnostic-codes:start -->

| Code     | Meaning                                                                                          | What to do                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LP0101` | No trusted origin configured in production; nothing will be accepted                             | Pass `allowedOrigins` — read `PUBLIC_PAYLOAD_ADMIN_ORIGIN` on the server and hand the value in; the runtime reads no environment variable in the browser. Nothing is accepted until you do.                                                              |
| `LP0102` | Origin trust rests on `document.referrer`, so any framing site is trusted                        | Any framing site is trusted. Set `allowedOrigins` and serve a `frame-ancestors` CSP.                                                                                                                                                                     |
| `LP0103` | A plugin declares a runtime range this runtime does not satisfy; it was refused                  | The plugin's `compat` range does not include this runtime version, so it was not registered. Upgrade the plugin or the package until the ranges meet.                                                                                                    |
| `LP0201` | An update named a field with no binding anchor on the page                                       | Render the binding anchor unconditionally so an edit to an initially empty field has somewhere to land; `data-payload-boundary` keeps a hidden anchor for it.                                                                                            |
| `LP0202` | Owner scoping is on and the update names no document it could belong to                          | The message carries neither a global slug nor a collection slug plus `id`, so owner scoping cannot route it; nothing was applied. Check the admin's live-preview setup for that collection, or turn `scopeBindingsByOwner` off on that page.             |
| `LP0301` | The visibility gate held offscreen writes back until they scroll into view                       | Raise `visibilityGateThreshold` (or set `disableVisibilityGate`), or accept that below-the-fold updates wait for a scroll.                                                                                                                               |
| `LP0401` | A value was refused because the attribute or the value itself is unsafe                          | The attribute (`on*`, `style`, `srcdoc`, `formaction`, `id`, `name`, …) or the value (a `javascript:` or `data:` URL) is refused by design. Bind a different attribute or fix the value; the rules are in [security.md](security.md).                    |
| `LP0402` | A text element has structured children, so replacing its text was skipped                        | Move `data-payload-field` to the element that holds the value, or add `data-payload-text` to replace the children anyway.                                                                                                                                |
| `LP0403` | A structural container has no array template, so the update was skipped                          | Add `data-payload-array-template` to the container.                                                                                                                                                                                                      |
| `LP0404` | A structural item has no `id`; it pairs positionally, so an insert re-renders every row after it | Give every item a stable `id`; without one items pair by position and an insert re-renders every row after it.                                                                                                                                           |
| `LP0405` | Two structural items share a key; later ones pair positionally                                   | Make the key unique per item; later duplicates pair by position.                                                                                                                                                                                         |
| `LP0406` | Every structural key changed while the length did not; the source generates keys per message     | The source generates keys per message, so the morph cannot retain nodes across updates. Key items by a stable field, or accept a re-render per update.                                                                                                   |
| `LP0407` | A binding asks for a delivery strategy this release does not have; it is left unchanged          | Only `patch`, `fragment` and `route` exist; fix the `data-payload-strategy` value. The element is left unchanged.                                                                                                                                        |
| `LP0501` | A message was rejected before it reached the update pipeline                                     | The reason is one of origin, shape, type, token and is visible with `debug: true`. An origin reason means `allowedOrigins` does not list the sender.                                                                                                     |
| `LP0502` | A preview token was rejected                                                                     | Your `validateToken` refused the token or threw — a throwing validator fails closed. Check the token the admin sends and the validator.                                                                                                                  |
| `LP0601` | A consumer event handler threw                                                                   | Your `on(...)` handler threw; the runtime continued. Fix the handler.                                                                                                                                                                                    |
| `LP0602` | A consumer transform threw; the original value was kept                                          | Your transform threw; the original value was kept. Fix the transform.                                                                                                                                                                                    |
| `LP0603` | A renderer threw while writing a value                                                           | A renderer threw; that one write was abandoned. A custom renderer must not throw on a value it does not expect.                                                                                                                                          |
| `LP0605` | Runtime startup failed                                                                           | The runtime could not start once the document was ready and rolled back; the cause is on the `error` event with context `startup` — usually a browser without `MutationObserver`/`IntersectionObserver`, or a document with no `body` yet.               |
| `LP0606` | Sending the ready handshake failed                                                               | Posting the `ready` handshake threw (`error` event, context `ready`); without it the admin never sends the document. Read the attached error: the built-in sender tolerates a malformed origin, so the cause is the host window or a custom `sendReady`. |
| `LP0701` | The audit found no runtime in a response that carried preview intent                             | If you use an adapter, check its `inject` mode and whether a proxy strips `Sec-Fetch-Dest`. If you start the client yourself, this line is expected.                                                                                                     |
| `LP0702` | The preview response declares no `frame-ancestors`                                               | Let the adapter manage CSP, or add the admin origin to your own `frame-ancestors`. As an error the served policy does not admit `--admin`: add that origin to `allowedOrigins`.                                                                          |
| `LP0703` | `X-Frame-Options` forbids framing, which no CSP can undo                                         | Remove `X-Frame-Options` from preview responses; a proxy or a security middleware usually sets it, and no CSP directive overrides it.                                                                                                                    |
| `LP0704` | Binding attributes are served to anonymous visitors                                              | Gate binding emission on an authorized preview context with `createPreviewBindings()`; its suppressed form emits nothing at all.                                                                                                                         |
| `LP0705` | More bindings than the default visibility gate will write eagerly                                | Raise `visibilityGateThreshold` if the whole page must stay live, or confirm that deferring below the fold is acceptable here.                                                                                                                           |
| `LP0706` | Owner markers exist, but some bindings are outside all of them                                   | Give every binding an owning `data-payload-owner` ancestor, or leave `scopeBindingsByOwner` off until they all have one.                                                                                                                                 |
| `LP0707` | The preview response carries no bindings at all                                                  | Add binding attributes to the markup; `pll-codegen --inventory` lists every field the schema makes addressable.                                                                                                                                          |
| `LP0708` | The URL did not return an HTML page, so nothing else can be judged                               | Point the audit at a route that renders an HTML document. Redirects are reported, not followed, so probe the final URL; a redirect to a login needs a session the probe cannot supply.                                                                   |
| `LP0709` | A readiness row is not yet at its 2.0 value; `pll doctor --v2` reports it                        | A runtime row is still at its `defaults: 'v1'` value. Set the option the finding names, or drop `defaults: 'v1'` once the page no longer needs it.                                                                                                       |
| `LP0710` | The preview runtime is served to anonymous visitors, not only inside the admin frame             | Correct for `inject: 'always'`. Under `'preview-only'` it means every request counts as intent: check `previewSignals` and `previewQueryParams`.                                                                                                         |
| `LP0801` | A fragment request failed (network, timeout, server error); the boundary was patched instead     | Network, timeout or a 5xx from the fragment endpoint; the boundary was patched from the same revision. Check the endpoint's logs and its limits.                                                                                                         |
| `LP0802` | The fragment response had the wrong content type or shape; the boundary was patched instead      | Wrong content type, shape, size or boundary; patched instead. Make sure the request reaches the fragment endpoint itself, not a proxy or an error page.                                                                                                  |
| `LP0803` | The fragment endpoint refused the preview (not authorized); the boundary was patched instead     | 401/403 — the page's authorization did not hold for the endpoint; patched instead. The endpoint verifies the same token or session as the page, so it must receive it too (same origin, cookies, query).                                                 |
| `LP0804` | A fragment response arrived for a revision that was already superseded and was discarded         | It belonged to a superseded revision; nothing was applied. Nothing to do.                                                                                                                                                                                |
| `LP0805` | A route refresh was requested again for the same revision; the loop guard stopped it             | The same revision asked for a second refresh; the guard refused it. Nothing to do; `inspect().route.loopStopped` counts them.                                                                                                                            |
| `LP0806` | A boundary asks for the fragment strategy but no fragment handler is configured; it is patched   | Configure `fragments: { endpoint }` on the adapter so boundaries render on the server; until then they are patched.                                                                                                                                      |

Reserved and unassigned: `LP0604`.

<!-- diagnostic-codes:end -->

Codes on the `error` event can be branched on directly:

```ts
import { DIAGNOSTIC_CODES } from 'payload-live-preview';

client.events.on('error', (e) => {
  if (e.code === DIAGNOSTIC_CODES.TransformThrew) reportToSentry(e.error);
});
```
