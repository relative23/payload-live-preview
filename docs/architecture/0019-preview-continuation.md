# ADR 0019 — One-time entry and scoped preview continuation

**Status:** Proposed • **Date:** 2026-09-25

Executable reference contract, not a public package API.

## Problem and boundary

H04 reproduces an availability conflict: a page consumes its signed entry
token, then fragments and reloads present the same token and are refused.
Moving that token from a query to a header does not change its one-time
meaning. H11 adds a second constraint: the browser must not inherit a private
Payload credential from the server's initial read.

Keep the existing signed-token, Payload-session and verifier strategies. The
first implementation is an application-side reference under `tests/fixtures/`,
using the real authorization and fragment modules. It selects a contract for
later package and native-framework work; it is not a shipped session store or
a claim that H04/H11 are closed. There is no 2.x default or token-format change.

## Verified binding, not posted authority

The reference requires an independently verified host login on entry and on
every continuation request. Its resolver returns an editor subject, a login
session identity, an expiry and that user's minimal Payload request material.
A separate server-side mapping selects an allowed audience, page path,
document, locale, maximum depth and expiry for that principal. Form fields,
fragment keys, query flags and Origin headers cannot create this mapping.

The entry token must have the same subject, audience, path and locale. Missing
subject or path is refused in this opt-in flow even though the existing token
strategy accepts those omissions. No document/session claims are retrofitted
into the current token. The verified host session and server mapping provide
those bindings. Changing either mapping or login revokes subsequent access.
This is intentionally narrower than a cookie-less cross-site preview link.

Each continuation authorizes afresh against that mapping and the store. The
context produced by the existing verifier is request-local. It is not cached
between requests. Private Payload headers come from the current verified
principal, never from browser data or a process-wide service credential.

## Exchange and failure semantics

The existing replay store atomically reserves the verified token's `jti` until
its original expiry. Only its first successful consumer may publish a new
continuation record. Publication is an insert-if-absent, and no credential is
returned before its acknowledgement. The handle is 256 random bits; the store
looks it up by SHA-256 rather than retaining the bearer value.

This is a monotonic, fail-closed two-step exchange, not a claim of a distributed
transaction across both writes. Its externally testable property is at most
one published grant for one entry. If binding, publication, cancellation or a
lost acknowledgement fails after consumption, the entry stays spent. A new
entry proof is required; rollback must never make the old proof usable again.
A committed but undisclosed record can expire without being used. Store TTL
cleanup never replaces the expiry check at read time.

The grant expires at the earliest of entry expiry, host-login expiry,
server-mapping expiry and a five-minute reference ceiling. Reads do not renew
it. A missing store, a store exception, an unknown handle or a revoked record
refuses authorization. Every instance must use the same durable, atomic store
and authentication source in deployment. An in-memory test implementation
proves coordinator behavior only, not distributed storage or failover.

## Request lifetime

The reference's `totalTimeoutMs` defaults to 1,000 ms and accepts only positive
integers within the platform timer range. One monotonic deadline covers login,
mapping, token/verifier work, consumption, publication and reading. It is not
renewed between phases. Each dependency receives the same request-local signal;
store adapters must pass it to cancellable I/O. The atomic store operation must
never interpret cancellation as permission to restore a consumed entry.

Every phase races cancellation, checks elapsed time before starting and after
settling, and observes late rejection. The replay-store wrapper also checks the
lifetime itself: token verification that finishes late cannot start consumption.
A stopped exchange returns an empty private 403 without a cookie; continuation
returns no grant. Backend exceptions retain the generic empty 503 on entry.
Timers and the incoming abort listener are removed on every settled path.
Other requests have independent clocks, signals and cleanup.

This bounds waiting for asynchronous dependencies, not their physical execution.
A store that ignores cancellation can still commit its in-flight write. Such a
commit remains spent and undisclosed; there is no retry or compensating rollback.
Synchronous work can block the event loop past the deadline. The next boundary
then refuses, but a CPU hard limit requires host isolation. None of these tests
establishes cancellation, durability or failover for a deployed store driver.

## Transport, cache and isolation

For the selected same-site deployment, return a host-only `__Host-` cookie
with `Secure`, `HttpOnly`, `Path=/` and explicit `SameSite=Strict`. Cookie names
are derived from the full server-selected target so opening a second document
or locale does not overwrite the first document's handle. Server scope checks
remain mandatory; cookie path is not an authorization boundary. These cookie
attributes and their limitations are described in the
[browser reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

The entry response redirects to a fixed, token-free relative page URL, carries
`Cache-Control: private, no-store`, `Vary: Cookie` and
`Referrer-Policy: no-referrer`. Successful pages, data responses and all
refusals retain those cache/referrer rules. Neither the token nor continuation
handle belongs in HTML, JSON, diagnostics, analytics or access logs. The
deployment must scrub entry-query and Cookie/Set-Cookie logs before ingestion.
Short TTL does not remove that requirement. The
[session-management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
also distinguishes unpredictable identifiers from server-enforced session
expiry and logout.

A same-site cookie does not solve an iframe on a different site. No automatic
fallback to `SameSite=None`, query continuation, unsigned authorization or
weaker origin checks is allowed. A non-URL header handle for controlled
requests needs its own browser and host-login contract before support is
claimed. Browser acceptance/blocking of cookies requires actual browser tests;
a local HTTP client asserting headers is not that evidence.

## Consumers and remaining work

The reference page and reload resolve the trusted target before authorizing.
Its data handler now selects Payload origin, collection/global, ID, locale and
depth from that binding. The isolated SQLite/Payload REST fixture below now
checks two real users, relations and uploads. The earlier synthetic REST
fixture remains separate evidence.

### Same-origin data-read reference

`tests/fixtures/preview-continuation-data.ts` composes the current grant with
the real `definePreview` reader. `withGrant` keeps the original monotonic
deadline active through fetch, every body read, decoding and response creation.
Each phase also checks grant expiry. An expired or stopped request returns no
data; a late fetch body is cancelled without being read. Acquired readers are
cancelled on failure and released; unread bodies are disposed even when the
package refuses before calling the JSON reader. Cancellation acknowledgement
cannot extend the deadline.

This reference reads a saved draft. It does not post unsaved form values to
Payload, populate a changed relationship ID or claim unsaved-live data merging.
The earlier fragment journey still renders two unsaved revisions separately.
The GET handler runs at the bound page path; the fixture chooses it as that
route's data representation. Only one `preview=true` and the mapped locale
are accepted. Other query keys, document selectors and depth overrides are
refused before fetching. Browser headers never become Payload credentials.

The upstream request retains `cache: 'no-store'` and `redirect: 'error'`.
JSON requires the JSON media type and valid UTF-8. The reference counts actual
body bytes, with a 65,536-byte default cap, not the declared content length.
That cap bounds this read fixture, not the package's general document capacity.
The outer JSON shape is `{ version: 1, ok: true, data }` on success, or
`{ version: 1, ok: false, error }` without data on failure. The error is generic;
upstream bodies, headers, credentials and network exceptions do not cross it.
All responses retain private cache/referrer headers. This local envelope is
not a selected public wire protocol.

Collection documents require the bound ID. A global must carry its matching
`globalType` or pass an explicit server-side `globalDocument` schema predicate.
The predicate is trusted application code, never browser configuration. Tests
include a legitimate global whose only field is a string-valued `errors` and
reject a different shape against that declared schema. There is no universal
way to distinguish an incorrectly successful upstream error from identical
valid content. A deployment whose schema permits that ambiguity needs an
upstream discriminator; field names alone are not evidence. The package's
raw REST and projected-document behavior is unchanged.

A loopback HTTP test forwards only the verified user's material, refuses a
redirect and recovers on the next request. A test-only envelope bridge into
the real `DocumentSession` proves last-good state on 401/403/429/500, an
unidentified HTTP-200 body and revocation, then recovery. It is a saved-read
consumer probe, not a public merge adapter, native hook journey or Payload ACL
test. Built public server-entry composition is checked separately from clean
tarball installation and native browser tests.

### Real Payload ACL reference

`npm run test:acl:real-payload -- --tarball /absolute/package.tgz` installs
the explicit archive and locked Payload/SQLite 3.89.0 dependencies in a fresh
directory outside the workspace. It type-checks the fixture strictly, then
starts the actual Payload REST handler on loopback with a new SQLite database.
The default install is offline; `--online` permits filling a missing npm cache.
Install-script approval remains explicit. A workspace installation first failed
because the parent supplied a different Payload live-preview dependency; the
isolated gate does not disable that upstream consistency check.

Setup alone creates the users, private documents, localized saved drafts,
relations, uploads and globals with privileged Local API writes. Measured
reads use ordinary REST ACLs and each user's own JWT, never an all-access
credential. The reference checks `/users/me` on every authorization. Real
logout invalidates the session before the next data read, while the other
user and a fresh login continue independently. The host-cookie mapping and
grant store are still process-local references, not native login middleware.

Twenty-five contract groups pass on the retained capability archive. Initial
and repeated reads agree at depths 0, 1 and 2 and in English/German. Foreign
documents and metadata return 404; foreign file bytes and anonymous reads
return 403. In populated allowed documents, denied relations and uploads
remain scalar IDs, with no foreign fields or file bytes. Those IDs are still
visible under this schema; applications requiring confidential links need
field-level access rules. No content save or publication occurs after setup;
authentication operations do update their own session records.

The seeded global contains `globalType`. A real unseeded global instead returns
only its default text-valued `errors` field with HTTP 200. The reference refuses
it without a declared schema and accepts it with the exact application schema.
This confirms the earlier empty-database counterexample without a database
stub, but still cannot disambiguate identical valid and erroneous 200 bodies.

This is a clean-tarball Node/REST/SQLite result, not a Next production server,
browser cookie test, Payload 2 result or unsaved population transport. The
next reference must prove two unsaved relationship revisions, independently
recheck the bound document's ACL, and retain locale/depth/byte/deadline limits
without writing content. No public handler or wire protocol is introduced here.

The reference now supplies the additive `scope.payload` capability described
in ADR 0006 §5c. Its server mapping includes the Payload base and API route,
separate from the site's audience. The shared fragment endpoint checks the
document before the registry runs; `definePreview` checks the direct read's
target, locale and maximum depth before forwarding headers. The registry no
longer duplicates document authorization. Unsaved fields are rendering input
only and must never select another read target. These package checks do not
provide host-login integration or a durable store. The separate ACL reference
above proves only its named Payload version and schema.

The reference now tests deadlines and late store completion. Before publishing
a helper, verify durable store operations, revocation authority, multi-tab
grant-count limits and host-login integration. Test the
document/depth capability through clean tarballs and each
native framework. Any new public helper or scope is additive minor, with a
changeset and migration instructions. The initial reference charge added none;
the subsequent scope charge is an opt-in minor API addition, not a session API.

### Selected unsaved population contract

The reference accepts same-origin POSTs at the mapped page path, with
`application/json` and an exact `{ version: 1, revision, data }` envelope.
`revision` is a positive safe integer, a correlation value rather than
authority. The initial schema is deliberately limited to an `articles`
collection with a text `title` and positive safe-integer ID arrays `related`
and `files`, matching the SQLite fixture's schema. Numeric strings are refused:
the real Payload probe leaves them unpopulated even when their numeric ID is
readable. String/custom-ID collections need a separately declared schema.
Unknown fields, embedded relation objects, owner/identity selectors and
upstream options are refused. The browser cannot choose locale, depth, API
base, collection or document. An explicit matching Origin is required.

One continuation lifetime includes request-body reading, an independent
depth-zero saved-document read, population and response creation. Count actual
UTF-8 bytes on input and each upstream response (65,536 by default); cap each
relation array at 32 IDs. The independently authorized saved document supplies
identity and non-editable fields. Only validated form fields replace it in a
server-constructed Payload data-input request. Use the verified user's current
credential, a server-set GET method override, no redirects and no cache. Never
forward the browser's Payload options or use posted owner values as permission.

The Payload 3.89.0 probe confirms that a successful data-input response is not
a root-document ACL check: saved GET returns 404 for the other user's document,
while supplied data is processed with HTTP 200. No foreign fields are disclosed
in this fixture; denied populations retain IDs. The reference refuses when
its independent saved read fails, before any population request. Read
access and field hooks are application code; this fixture does not prove a
transactional permission snapshot or safety for arbitrary hook implementations.
There are no content writes in the selected fixture after setup.

The initial composition also demonstrated that `draft=true` replaces supplied
values with the saved revision. The independent ACL read remains a draft read;
the subsequent server-constructed body uses `draft: false` and
`flattenLocales: false` so Payload processes the already flattened snapshot.
These are server decisions, not browser options. That first fixture's records
and uploads are not versioned. The versioned mode below now measures the
remaining draft-selection gap before selecting a public transport.

Success is `{ version: 1, ok: true, revision, data }`; the revision must match
the consumer's pending request. Failure retains the existing generic envelope
without data. The consumer also discards superseded completions and preserves
its last good snapshot across refusal, then accepts a subsequent valid revision.
The reference does not persist a global revision counter: independent tabs do
not share ordering. The saved GET handler and production direct REST remain
unchanged. Globals, polymorphic/nested schemas, native hook/composable wiring,
browser cookies and Payload 2 need separate evidence before broader support.

The retained-tarball gate's `--unsaved` mode passes 11 contract groups over 95
real REST requests: two users, two consecutive changed relationship/upload
selections, English/German and depth 0/1/2, denied roots and foreign selections,
and recovery with zero content writes. Eighty new deterministic cases include
input/response limits, each stalled or aborted I/O phase, and the actual
DocumentSession's stale-result refusal and last-good recovery. The latter uses
a test-only envelope bridge and synthetic upstream population; it is separate
from the database result, not a native React/Vue integration claim.

### Versioned related documents: measured limitation and selected next step

The isolated gate's `--related-drafts` mode seeds separate published and newer
saved-draft titles for records and upload metadata in English and German,
before measurement starts. Two real users run 27 characterization groups over
190 REST requests. All observations match, but **none of the 16 populated
cases meets the combined unsaved-root/related-draft requirement**. The optional
`--require-related-drafts` gate at that checkpoint asserted the requirement
and exited 1 with all 16 cases failing. A green characterization is not product
acceptance; the later opt-in composition below supplies a separate result.

| Existing path                      | Root revision             | Related record/upload metadata |
| ---------------------------------- | ------------------------- | ------------------------------ |
| Authorized saved GET, `draft=true` | Saved draft               | Authorized saved drafts        |
| Reference data POST, `draft=false` | Current unsaved form      | Published values               |
| Native data POST, `draft=true`     | Saved draft replaces form | Authorized saved drafts        |

The native POST also returns the root's localized title map when
`flattenLocales=false`: after draft replacement the input is no longer the
already flattened form. Its related titles are localized strings. Neither
version of the flag in this composition is evidence for both desired revisions
together. There is no new production implementation in this charge.

Revocation is a controlled change to the fixture's actual Payload read-access
function. Both published and draft metadata reads then return 404, file bytes
return 403, and population returns IDs rather than revoked fields. A revocation
between the independent root read and the population read is also honored.
Restoring that policy recovers; the other user remains independent. Twelve
process-local policy changes are counted separately from zero content writes.
This does not prove a durable revocation service or an atomic permission
snapshot. Upload file contents do not differ between versions in this fixture;
metadata version selection and file authorization are the measured contracts.

Selected next step: an **application-side, schema-allowlisted related-draft
composition**, not a public handler or a flag change to the existing reader.
Keep the independent root ACL read and the native form processing for field
access/hooks. Only fields actually retained by that processing may be enriched;
never restore a field removed by access control or an application hook. The
trusted application schema names `articles.related -> records`,
`articles.files -> media` and `records.next -> records`. Browser IDs are values,
not permission to select a collection, URL, arbitrary field or credential.

The root capability deliberately refuses a separate `records` read with
reason `scope` before fetch. Do not widen, mutate, cast or reuse it as an
unrestricted reader. Each related read needs a separately justified exact
target from the trusted field policy and a current user-specific Payload ACL
check, with the parent expiry/depth/locale/lifetime as ceilings. No global
service credential, `overrideAccess` read or cross-request data cache is allowed.
The concrete derivation stays application-side until its authority contract
has executable tests; this ADR does not add a public capability API.

Proposed reference limits: 64 distinct related reads, 1 MiB aggregate upstream
body bytes, at most four concurrent reads, in addition to the existing per-body
caps and original deadline. These are conservative bounds to test, not measured
capacity or package defaults. Descending one edge consumes one depth level;
duplicate reads may be shared only within the same request and identical
user/target/locale/depth. Budget exhaustion or malformed/mismatched responses
must refuse the complete revision, not silently return a partly enriched one.
ACL-denied references retain only the IDs permitted by the selected schema,
never a previous populated object. Direct draft GET may return a published
fallback when no accessible draft exists; tests must name that result rather
than call every response a draft or a fully current revision.

Acceptance for that next composition: all 16 required cases pass with the
unchanged unsaved root and allowed related drafts; native comparison cases
remain separate. Add field-ACL removal, draft-only/published-only relations,
revocation, deeper/shared references, byte/fan-out limits, cancellation and
stale/last-good recovery. Keep content writes at zero and repeat clean-tarball
and current input/lifetime tests. Arbitrary hooks, polymorphic/custom-ID/global
schemas, native host cookies and framework hooks remain separate contracts.

### Schema-allowlisted composition (2026-09-26)

The reference now accepts an opt-in `relatedDrafts: {}` option. This is still
application-side code, not an exported package handler. It independently reads
the saved root, then sends the validated form through native field access and
hooks at depth zero. The body still disables saved-root replacement. Only
retained `articles.related`, `articles.files` and `records.next` fields are
traversed. Missing or null fields stay absent or null; populated objects,
string IDs and other unsupported shapes refuse rather than selecting a target.
Hook-rewritten IDs are the input to enrichment, not the original posted IDs.

For each allowed edge, the trusted application field graph supplies the exact
collection and the verified principal supplies current per-user credentials.
The real `authorizePreviewRequest` verifier creates a fresh, exact-target
context with the same subject, expiry, audience, path and locale, and maximum
native depth zero. It never edits, casts or reuses the root capability as a
related capability. The real `definePreview` performs a normal authenticated
draft GET; Payload's read and field ACLs remain authoritative. A published-only
fallback retains its actual `_status`, rather than being labeled a draft.

Reads are sequential, at most one in flight per preview request. This is below
the proposed concurrency ceiling of four; parallel scheduling has not been
implemented or benchmarked. The limits are 64 distinct collection/ID/remaining-
depth reads and 1 MiB of consumed upstream body bytes, including the saved root
and form-processing responses. Trusted options may lower these two ceilings.
The existing per-body default remains 65,536 bytes; the assembled envelope
obeys the same configured byte cap. Replacement sizes are checked before
constructing an oversized expanded tree, including repeated cached values.
Declared Content-Length does not replace actual UTF-8 byte accounting.

Each edge consumes one depth. Successful and denied lookups are cached only
within one request and at the same remaining depth. This is not an atomic ACL
snapshot: a previously completed read is not reauthorized on a same-request
cache hit. A later request always rechecks the host grant and Payload access.
Related 403/404 responses retain only the allowed scalar ID. Other transport,
identity, schema or budget failures refuse the whole revision. All phases,
including child verification and body reading, share the parent's original
deadline and grant expiry. Late bodies are cancelled without waiting for their
producer to acknowledge cancellation.

V394-G passes all 16 required combined cases inside 51 real-Payload groups /
386 REST requests. Both users, both locales, depth 0/1/2, consecutive selections,
draft-only/published-only documents and metadata, field removal, intervening
revocation and recovery are checked. There are zero content writes after setup;
24 process-local policy changes are counted separately. The installed package
is the retained capability tarball, with both authorizer and reader injected
from that consumer. The native limitation mode remains separate (27/190).

The source neighborhood adds 52 cases, including 41 authority/budget cases,
10 lifetime cases and a second DocumentSession mode. It verifies stale refusal,
last-good state on transport errors, ID-only state after related access denial
and recovery. The retained pre-composition handler fails 40/41 final focused
cases; depth zero was already valid. These consumer tests use a synthetic
upstream and test-only envelope bridge, not native framework hooks.

Remaining boundaries include arbitrary schemas/hooks and relationship filters,
custom or polymorphic IDs, globals, Payload 2, other database adapters, native
browser cookies and durable stores. No public API/default/version changes are
made. Disabling the option restores the earlier reference behavior without
changing the package or replay protection. The next bounded unit is native
Next.js production/TLS host-login and cookie wiring with the real two-user
backend; the existing unauthenticated mock token-minting route is not evidence
for that contract.

### Native Next host and browser reference (2026-09-26)

The isolated consumer now builds Next 16.3.4 with React/React DOM 19.2.7,
using the reviewed Next lock and the retained capability archive. The local
application templates live in `tests/fixtures/next-continuation/`; package
imports in the reference bundle stay external and resolve inside that clean
consumer. The existing mock example and its token-minting contract are unchanged.
This measures a native App Router page with the packed React hook and a local
envelope bridge, not a new public transport or every Next rendering mode.

An explicit local-test environment switch enables the routes. A real Payload
login creates a random host-only Secure/HttpOnly/Strict cookie; its server-side
record retains the user's JWT. Each continuation calls the actual `/users/me`.
The verified subject and fixed server mapping select document, locale and
depth. Login input cannot name a subject or select a mapping. The independent
test issuer sends an entry proof in a header, not in the URL; exchange redirects
to the token-free page. There is no public issuer route or browser service JWT.

Host state is process-local and bounded: 32 logins, 128 grants and 256 replay
records, swept at access and never renewed by a read. Logout removes the host
record and its grants and calls real Payload logout. A stalled login body now
races abort and releases its reader; the new regression failed before that
correction. Existing continuation, per-user ACL and population limits remain.
These limits are fixture policy, not a distributed-store capacity guarantee.

Six journeys pass in Chromium, Firefox and WebKit: visible consecutive unsaved
root/relationship/upload-metadata revisions; preserved local counter/input;
native navigation and reload; independent users and locale tabs; denied and
revoked relations; replay, expiry, logout and missing cookies; late results,
last-good state and recovery. The first complete run uses 145 REST requests
per browser, zero content writes and two process-local policy changes. Tests
assert rendered DOM, not just HTTP status or a refresh request.

The TLS proxy is part of this deployment contract. Next replaces config-level
`Vary` on page responses, so the trusted local front door appends `Cookie` while
retaining RSC/router variation. Private/no-store and no-referrer remain required.
The browser accepts a self-signed local certificate through the test context;
the runner's readiness request validates that exact certificate. This is not
a public-CA, Traefik or cross-site Safari acceptance claim. Cookie removal
proves refusal without a weaker fallback, not third-party-cookie policy parity.

The editor sends synthetic messages from the actual parent window; it is not
Payload Admin UI. A remount/reload starts from saved data and accepts a fresh
unsaved message; no persistent snapshot is claimed. The bridge uses `fetchFn`,
whose public declaration still describes test injection. Public extraction,
durable storage, arbitrary schemas, Payload 2 and equivalent host journeys for
the other framework families remain open. No package API/default changes.

### Native SvelteKit host and hydrated owner (2026-09-26)

The second host consumer uses SvelteKit 2.70.2, Svelte 5.56.9, adapter-node
5.5.7, its Vite plugin 7.3.0 and Vite 8.2.1 from the reviewed fixture lock.
It installs the same explicit capability archive outside the workspace and
uses the existing adapter-node build/TLS runner. The installation helper is
now shared with the Next caller; each framework still gets its own clean
consumer, production build, browser identities and actual Payload database.

The selected mode is SSR followed by a **Svelte-owned hydrated component**.
The packed `livePreviewHandle` publishes the verified context to request
locals and manages preview CSP. Its `autoInject: false` selects one manually
mounted packed `LivePreviewClient`, not an unauthenticated or protection-free
path. The client keeps strict origin/source checks. Its public `beforeUpdate`
event is cancelled before package DOM writes; the component sends the fixed
unsaved envelope and commits only its newest successful response. Svelte
renders escaped values and owns the counter/input. The root is marked as an
island. This is an application composition, not a new Svelte document hook.

The host's `page()` operation captures the existing data handler's verified
context and response inside one request. A failed read exposes no context.
The handle and server `load` share that result; the context and private headers
are never returned in load data. Two new source contracts fail before this
method exists and pass afterwards, including concurrent requests and read
failure. The native successful client navigation independently observes
exactly one `/users/me` and one root read for that page request.

Kit's normalized `event.url` supplies the page target for internal data
requests. The pinned `respond.js` removes Kit's own data suffix/invalidation
parameters before hooks; the reference removes no arbitrary client query.
Server load reads the complete search string so adding a forbidden query
causes a new load instead of retaining an old allowed result. These choices
follow the [hook/locals contract](https://svelte.dev/docs/kit/hooks) and
[load dependency tracking](https://svelte.dev/docs/kit/load). Native navigation
asserts a real `__data.json` response and a surviving browser-document marker,
not a hidden full-page reload. A changed route key remounts the Svelte owner.

V439-G passes 18/18 across Chromium, Firefox and WebKit, with 152 real REST
requests, zero content writes and two local ACL changes per browser. It covers
the same login/cookie/scope/unsaved/last-good/revocation contracts as Next,
plus successful and refused native server loads. V440-G repeats all 18 Next
journeys after shared-helper extraction; V441-G retains 63/63 in the existing
SvelteKit production suite. Initial fixture event-API and test wait-API errors
are retained separately from successful acceptance.

This does not establish arbitrary Svelte fragment head/CSS/context parity,
another hydration ownership mode, real Admin input, cross-site cookie policy,
durable stores, persistent unsaved reload state, Payload 2 or other databases.
The Vite/Svelte build compiles the templates; no separate `svelte-check`
semantic pass is claimed. That check belongs before public recipe extraction.
No public API/default/version changes. The next bounded host consumer is Nuxt
3 with native Nitro request state and Vue lifecycle, not a Core-test proxy.

### Native Nuxt host and Vue owner (2026-09-26)

The next isolated host runs Nuxt 3.21.11, Vue 3.5.41, Nitro 2.13.4, H3
1.15.11 and Vite 8.2.2. It builds the real Nuxt application and starts Nitro's
Node output behind loopback TLS. The SvelteKit and Nuxt launchers now share
the Node/TLS runner; the existing SvelteKit entry and default fixture stay.
No standalone Vue fragment app stands in for Nuxt SSR in this reference.

Nitro middleware performs the bounded host page read and passes its verified
context to the packed `defineLivePreviewServerHandler`. The actual event
retains the decision; the packed `livePreviewNitroPlugin` reuses it during
`render:html`. The page reads that same event through
[useRequestEvent](https://nuxt.com/docs/3.x/api/composables/use-request-event).
Only a selected document and public path/locale/origin enter `useAsyncData`;
the context, JWT and host records never enter the serialized view. Each SSR
mount and successful navigation asserts one current-user check and one root
read. The render hook also checks that the verified context is unchanged.

The page uses Nuxt's [SSR data mechanism](https://nuxt.com/docs/3.x/api/composables/use-async-data)
to reuse initial data during hydration. Later native Vue-router navigation
fetches a fresh same-origin page representation; an old URL's cached result
does not restore authorization. The complete query is retained and validated.
Successful reordered queries and refused extra parameters are exercised while
the browser-document marker survives. A changed page key remounts the owner.

The packed Vue `useLivePreviewDocument` owns the reactive document and scope
cleanup. A local `fetchFn` test bridge validates the collection/ID/locale and
envelope revision, while the composable handles supersession and last-good
state. `autoInject: false` prevents a second DOM writer; origin/source checks,
current per-user ACLs, cookie requirements and replay protection remain intact.
The native request bridge reads Node chunks only on demand, carries socket
disconnects to the request signal, and pauses an unread body on refusal rather
than destroying the response socket. Unread uploads close keep-alive after
the response; seven unit cases retain demand, completion and listener cleanup.

The first install refused because the shared helper discarded reviewed
version-specific install-script approvals. Restoring the fixture's approvals
keeps strict npm policy enabled. A subsequent post-ci archive install changed
transitive Vite to 8.3.0 and the exact-version assertion failed. The helper now
replaces only the workspace package record with the inspected tarball metadata
and SHA-512 integrity before one `npm ci`; it does not perform a second
resolution. Original dependency versions, registry integrities and repository
locks remain unchanged. All three native hosts use this derived-lock path.

V463-G passes 18/18 Nuxt journeys across Chromium/Firefox/WebKit, each with
152 real Payload/SQLite 3.89.0 requests, zero content writes and two local
ACL changes. Next and SvelteKit each pass 18/18 again, and the unchanged
SvelteKit production fixture passes 63/63 through the shared runner.

This proves the selected Nuxt SSR/composable owner, not all fragment-provider,
head/CSS/resource or module-onboarding contracts in H18. The build compiles
SFCs but is not a separate semantic `vue-tsc` check; that remains required
before public recipe extraction. Test parent messages/proof issuance, same-site
cookies and process-local storage retain the earlier limits. There is no
public API/default/version change or claim that H04/H11/H18 are closed.

### Native Astro host and element lifetime (2026-09-27)

The Astro consumer builds 7.3.2 with `@astrojs/node` 11.1.4 and Vite 8.1.4,
then serves the actual standalone Node output behind the same loopback TLS
runner. The existing 7.3.2 example is static, while the older SSR examples
pin 7.2.9. A separate dependency fixture therefore pins the new combination;
none of those example locks is silently upgraded. Its complete lock and exact
esbuild 0.28.1 script approval are checked. Offline metadata and archive cache
misses are retained as setup failures, not product failures or browser passes.

Native [middleware locals](https://docs.astro.build/en/guides/middleware/) hold
one page result and its branded context. The packed
`createLivePreviewMiddleware` consumes that decision before Astro renders.
The page asserts context identity; each initial mount and successful native
navigation observes one current-user check and one root read. Only escaped
document fields and public ID/path/locale/origin reach the component. Host
state and Payload credentials remain server-side. Query fields are preserved
for validation; canonicalization trusts only the fixed local proxy boundary.

The selected owner is an Astro component's custom element, not a hydrated
React/Vue tree. A processed module defines it once. Connection mounts a packed
client with strict origin/source ingress; the public `beforeUpdate` event is
cancelled before package DOM writes. The application requests the same bounded
unsaved envelope and replaces only text nodes from the newest successful
revision. Counter/input state stays intact. `autoInject: false` selects this
single writer without disabling authorization, CSP or message guards.

Astro's real [ClientRouter](https://docs.astro.build/en/guides/view-transitions/)
performs HTML navigation, including a private 403 refusal page. The browser
document marker survives; there is no custom router or forced page reload.
Removing the old element aborts its requests, invalidates completions and
destroys its client. The test observes its stopped marker and exactly one
update request from the new owner. A remount starts with saved data until the
next editor message. This mode does not claim persistent unsaved replay.

V488-G passes seven journeys per browser, 21/21 total, against real
Payload/SQLite 3.89.0 and the unchanged retained capability archive. Each
browser records 168 REST requests, zero content writes and two local ACL
changes. The shared contract now also checks concurrent SSR and data reads
for two users/locales, beyond the existing sequential tab checks.

This is a native page/host proof, not closure of H05's isolated fragment
rendering-context, first-use CSS/resource or configured-renderer obligations.
Astro 4-6 and the exact Container feature floor remain separate. This Node
24.19.0 result does not establish Astro 7 on the package's Node 20 floor.
Native compilation is not a separate semantic Astro-template typecheck.
Actual Admin UI, cross-site cookies, durable stores and arbitrary schemas
retain the earlier boundaries. No package API/default/version change.

### Framework-free HTML host and native departure (2026-09-27)

The HTML consumer installs only the retained package, using the existing
pure-HTML lock with the archive substitution. Its Node-only build copies the
packed client entry and two application modules; it runs no framework compiler.
Resolution probes and the installed tree reject Astro, Next, Nuxt, React,
Svelte, Vue, Vite, esbuild and Payload in this app. The real Payload/SQLite
3.89.0 backend is a separate installation, not an undeclared HTML dependency.

An explicit Node service owns login, exchange, private page/data routes and
current-user checks. Its lazy request bridge retains the existing body and
cancellation limits. One verified page result supplies escaped HTML and only
public ID/path/locale/origin to the client. Exact asset allowlisting cannot
serve the private configuration. The public shell contains no preview script;
authorized pages load the packed client and their owner module under same-origin
script CSP. This selected fixture serves 140,950 and 3,419 raw JavaScript bytes,
respectively, not zero bootstrap bytes or a new package size budget.

The custom element owns text updates, counter/input state and one packed
client. Disconnect and pagehide abort its requests and destroy the client.
Links perform ordinary full-document navigation, not an emulated framework
router. The browser tests observe departure cleanup, fresh authorization and
new document identity. A separate live request is held across removal and
remount: its cancellation is observed, its late response cannot change the
new DOM, and exactly one replacement owner processes the next revision.
HTML-like input remains literal text. A persisted pageshow requests a fresh
reload; actual back/forward-cache restoration is not separately measured here.

V523-G passes 24/24 across Chromium, Firefox and WebKit on Node 24.19.0.
The seven common journeys record 168 REST requests and two local ACL changes
per browser; the separate owner journey records 18 requests and no policy
changes. Both have zero content writes. This is service-backed HTML, not
static-only server rendering, arbitrary custom-component support or a public
transport API. Real Admin input, cross-site cookies, durable stores, other
Payload/database versions and the final release archive remain separate.

### Standalone Vue SSR and effect-scope lifetime (2026-09-27)

The separate Vue consumer pins Vue/server-renderer/compiler-sfc 3.5.41,
Vite 8.2.2, its Vue plugin 6.0.8, vue-tsc 3.3.11 and TypeScript 5.9.3.
Its own strict lock installs the retained archive once, without Nuxt, Nitro,
React, Next, Astro, Svelte or Payload in the app. Payload/SQLite 3.89.0 stays
in the separate backend. The explicit Node service imports a compiled Vue SSR
entry and serves only the client assets recorded by its build. Client and SSR
outputs are separate, following [Vite's SSR build contract](https://vite.dev/guide/ssr.html).

The HTML reference now has a second real renderer: Vue's renderToString.
Only an already-authorized document plus public path/locale/origin reaches this
callback, not the principal, headers, stores or credentials. Public/refused
requests never invoke it; renderer failures produce a generic private 503.
The browser asserts actual server-rendered title markup before hydration and
then Vue-owned text updates. This fixed renderer is not a public arbitrary
async-component API or a new CPU/deadline guarantee.

An actual child effectScope owns the packed useLivePreviewDocument session.
Stopping it leaves the component, counter and input mounted but cancels the
held HTTP request and stops message updates. Starting one replacement scope
accepts one new revision; the released old response cannot overwrite it.
The test uses actual postMessage dispatch from the preview window to reject
an allowed-origin but wrong-window sender. It never fabricates Event.source.
Page departure unmounts the real Vue app. Ordinary links perform full-document
navigation and current authorization, not a simulated router. These choices
exercise [Vue's scope disposal contract](https://vuejs.org/api/reactivity-advanced.html#effectscope).

Production compilation alone cannot establish template types. The consumer
runs strict vue-tsc, consistent with [Vue's TypeScript guidance](https://vuejs.org/guide/typescript/overview.html).
Each clean consumer first compiles a deliberately invalid string.toFixed
template. Exactly TS2551 and exit 2 are required; the copied counterexample is
removed before the real strict template check and both production builds.
The genuine templates pass without skipLibCheck, broad attribute index
signatures or relaxed strictTemplates. Only two exact data attributes are
declared. This semantic check does not cover the other framework templates.

V556-G passes 24/24 across Chromium, Firefox and WebKit on Node 24.19.0.
The seven shared journeys record 168 REST requests/zero content writes/two
local ACL changes per browser; the independent scope test records 24/0/0.
Two unsaved related-draft/upload-metadata revisions, state retention, isolation,
stale/last-good/recovery and cookie/expiry/logout assertions remain required.
Reload begins saved data until a new message; no persisted unsaved snapshot,
real Admin input, cross-site cookie or actual BFCache restoration claim.
The client bundle is 81,276 raw bytes including Vue and the packed composable,
not a package-only budget. No production API/default/version changes.

## Acceptance for the first charge

- A real one-time signed token opens a page; two unsaved fragment revisions and
  a reload succeed with continuation while replaying the entry still fails.
- Two independent coordinators sharing the test store cannot publish two
  grants for concurrent use of one token.
- Wrong user, login session, audience, path, document, locale, depth, expiry,
  revocation and store failure refuse; no refused call reaches a draft read.
- Publication failure or abort discloses no cookie and never restores entry
  proof. Responses and diagnostics disclose no bearer or private header.
- Stalled login, mapping, verification, consumption, publication and read obey
  one deadline. Abort before or during either write, lost acknowledgement,
  late settlement and concurrent requests preserve the same refusal contract.
- The existing token/session/verifier tests stay intact. Local fixtures,
  production package behavior and native browser evidence remain separate.
