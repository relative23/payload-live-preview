# ADR 0010 — Protocol capabilities are observed, and Payload versions sit behind a profile

**Status:** Accepted • **Date:** 2026-08-27

## Context

`negotiateProtocol()` derived capabilities from a version the peer announces.
The stock Payload admin announces none, so against every real admin the
runtime reported `basic` and nothing else, and no runtime behaviour branched
on a capability: `CAPABILITY_REQUIREMENTS` was metadata (the 1.8.0 item
"capabilities are real"). Meanwhile the runtime did branch on Payload
versions implicitly — schema typing when `fieldSchemaJSON` arrives, a REST
merge whenever `serverURL` is set — without naming either.

## Decision

1. A capability is a declaration: the behaviour it gates, the version at
   which an announcing peer is granted it, the message feature that
   demonstrates it, and the fallback without it (`CAPABILITY_DECLARATIONS`).
   Every capability has a fallback; "degrades by declaration" means the
   fallback is written down and tested, not that the runtime throws.
2. Capabilities become active by version **or** by observation. The runtime
   reads each message's shape (`observeCapabilities`) and each document
   event, records what it saw, and renegotiates; `inspect().protocol`
   reports `capabilities` (active) and `observed` (the subset seen on the
   wire). Observation only adds; an announced version keeps its grants.
3. Payload-version-specific behaviour lives behind a **profile**
   (`detectProtocolProfile`): `payload-2` when a schema is on the wire
   (schema-owned collection GETs when raw relationships need population),
   `payload-3` when document or
   relationship events were seen, `unknown` until then (merged like 3.x —
   a needless request costs less than a lost population). The lifecycle asks
   the profile, never the version.
4. `externallyUpdatedRelationship` is handled as an **edge**: the field is a
   level, so an update fires `relationshipUpdate` and re-renders every bound
   field under `skipUnchanged` only when the event changed _and_ names a
   document other than the previewed one. A drawer edit changes populated
   values, not form values, so that update must not be skipped; a repeat of
   the same event says nothing new and must be. Payload 4 gets a profile only
   once its real protocol is in the corpus; nothing is speculated into
   production code.

2026-09-17 (2.0.2): item 1 describes one declaration; the code splits it in
two. `CAPABILITY_DECLARATIONS` (`src/core/protocol-version.ts`) holds only the
version that grants a capability (`since`) and the message feature that shows
it (`observed`). The gated behaviour and the fallback are prose in
`CAPABILITY_DOCUMENTATION` (`src/core/protocol-capability-docs.ts`), kept out of
the runtime module so the inline bundle ships the rules and not the text. The
unit test requires an entry in both for every capability.

## Consequences

- `inspect().protocol.capabilities` against a real Payload 3.x admin now
  reads `basic`, then `document-events`/`relationship-events` as they occur;
  `profile` settles on `payload-3`. The wire corpus test asserts this per
  captured version.
- A Payload 2.x schema supplies relation targets without a collection or
  global slug in the message. Scalar updates settle locally; raw relationship
  IDs are populated by collection GETs when `serverURL` is configured.
  The session retains the schema for subsequent messages that omit it.
- Adding a capability means adding a declaration with a fallback; the unit
  test refuses one without.

## Addendum (2026-10-03): a v2 schema does not mean populated values

The real Payload 2.32.3 admin posts a schema containing `relationTo: 'authors'`,
then a picker update with a raw string ID and no schema, collection slug or
global slug. The earlier claim that the admin always supplies populated
relationships was wrong. It made the DOM runtime keep a raw ID and left the
hook session unavailable because it looked for an absent v3 merge target.
The anonymized projection and both caller regressions retain this message
shape without inventing a target.

Both callers now use the shared schema-based branch of `DataMerger`. They
keep the accepted schema within their own session, preserve unsaved scalar
values and populate IDs with credentialed collection GETs, including the
configured depth and message locale. A v2 read never uses the v3 method
override POST: in Payload 2 a collection POST is a create operation and a
global POST is an update. Unknown peers keep the existing v3-style fallback.

The planner bounds traversal, identities, request count and URL length.
Polymorphic target entries share the existing node budget with field traversal:
the parser charges each copied target, and the planner independently charges
every validation scan, including reused lists and hasMany values. Unrelated
opaque metadata is not followed. Each block-definition candidate actually
examined also consumes that planner budget; repeated rows cannot restart it.
The limit bounds lookup work without imposing a new definition-count cap.
It refuses invalid destinations and redirects, requires every requested
response identity and fills an independent document only after the complete
plan succeeds. Native response bodies have a byte ceiling of one MiB and a
10,000-chunk work ceiling; refusal and supersession cancel the reader,
release its lock and remove the abort listener. The chunk ceiling has a
separate finite-stream regression, because empty chunks consume work without
increasing the byte count.

The public `populatesRelationships: 'admin' | 'server'` literals remain
compatible in 2.x. They identify the legacy transport family, not whether a
particular message already contains populated relationships. The runtime
selects the schema path from the observed profile and retained schema, rather
than treating `'admin'` as a reason to skip population.

The DOM planner also retains the accepted locale with its population cache.
An explicit SDK envelope changing from `en` to `fr` needs a new read even when
the relationship ID is unchanged; a `data.locale` control field alone is not
the cache key. Pages without a population consumer still make no request.
The regression supplies synthetic SDK envelopes and REST answers; it does
not claim that the native Payload 2 admin posts locale envelopes.

## Addendum (2026-10-04): failed reads do not establish cache validity

The DOM planner records the resolved locale only after a current population read
succeeds. An omitted locale remains a valid default context; it is distinct from
having no successful read. A population-relevant raw change invalidates the old
success even when the locale stays the same. For example, after author A was
populated, a refused read for author B cannot make a later identical B update skip
its required read. A forced refresh also invalidates that success.

Failure retains the existing partial fallback and its merge-shortfall diagnosis.
A later accepted update may try again; the runtime does not start a retry loop.
Successful repeated updates still reuse population. Restarting the runtime begins
a fresh raw comparison, so required population is read again. A locale-only failed
switch leaves the prior successful
locale usable when the caller returns to it without a population-relevant change.
The HTTP-refusal, fetch-throw, default-locale, restart and coalesced-update
regressions cover these distinctions. MergeNeed owns this validity decision and is
therefore included in critical coverage and the full nightly mutation scope.

When a page temporarily has no population consumer, the planner renders the raw
fields without advancing the comparison tied to its retained population. A
returning consumer then compares edits made during that absence: a changed
relationship requires a read, while the latest scalar fields and unchanged
population reuse need none. A related-save hint still invalidates prior success
during the absence, without sending a request. Public `refreshCache()` only
rescans bindings; the next accepted update makes the population decision.

## Addendum (2026-10-08): empty form arrays and blocks

Payload 2.32.3's form-state builder represents a non-null empty array or blocks
field as the numeric row count `0` when `forceFullValue` is false. The field
remains enabled for form data, so `reduceFieldsToValues` and `unflatten` carry
that value into the live-preview message.

For a schema-owned array or blocks field, the population planner converts this
exact numeric `0` to `[]` in its independent document copy. The input stays
unchanged. Scalar and JSON zeroes, relationship ID `0`, cleared values and
other invalid container shapes retain their existing meanings and guards.
The traversal and request limits remain unchanged.

The `DataMerger` and `DocumentSession` regressions exercise scalar updates with
`author: null` without a GET, and a raw author ID with one schema-owned collection
GET. These unit inputs reconstruct the installed sender codepath; they are not
captured native document-change packets or proof of restart/reload recovery.
