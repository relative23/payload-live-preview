---
'payload-live-preview': minor
---

Protocol capabilities are real. Each capability names the behaviour it gates
and the fallback without it (`CAPABILITY_DECLARATIONS`), and becomes active
by an announced protocol version or by observation — the stock Payload admin
announces no version, so the runtime reads what it can do off its messages.
`inspect().protocol` gains `observed` (the capabilities seen on the wire) and
`profile` (`payload-2`, `payload-3` or `unknown`). Payload-version-specific
behaviour sits behind that profile: a Payload 2.x admin, recognised by the
schema it sends, populates relationships itself, so the runtime no longer
re-merges its data through the REST API. A data update that carries
`externallyUpdatedRelationship` now fires the new `relationshipUpdate` event
and re-renders every bound field even under `skipUnchanged`, because a drawer
edit changes populated values, not form values. ADR 0010.
