# ADR 0010 — Protocol capabilities are observed, and Payload versions sit behind a profile

**Status:** accepted, 2026-08-27.

## Context

`negotiateProtocol()` derived capabilities from a version the peer announces.
The stock Payload admin announces none, so against every real admin the
runtime reported `basic` and nothing else, and no runtime behaviour branched
on a capability: `CAPABILITY_REQUIREMENTS` was metadata (roadmap 1.8.0,
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
   (`detectProtocolProfile`): `payload-2` when a schema is on the wire (the
   admin populates relationships; no REST merge), `payload-3` when document or
   relationship events were seen, `unknown` until then (merged like 3.x —
   a needless request costs less than a lost population). The lifecycle asks
   the profile, never the version.
4. `externallyUpdatedRelationship` is handled: the update that carries it
   fires `relationshipUpdate` and re-renders every bound field even under
   `skipUnchanged`, because a drawer edit changes populated values, not form
   values. Payload 4 gets a profile only once its real protocol is in the
   corpus; nothing is speculated into production code.

## Consequences

- `inspect().protocol.capabilities` against a real Payload 3.x admin now
  reads `basic`, then `document-events`/`relationship-events` as they occur;
  `profile` settles on `payload-3`. The wire corpus test asserts this per
  captured version.
- A Payload 2.x site with `serverURL` configured stops issuing REST merges
  once the schema has been seen; its populated data arrives from the admin
  as before. Recorded in the changeset.
- Adding a capability means adding a declaration with a fallback; the unit
  test refuses one without.
