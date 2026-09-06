---
'payload-live-preview': patch
---

`externallyUpdatedRelationship` is read as an event, not as a flag. Payload's
panel fills the field from `useDocumentEvents().mostRecentUpdate` — a state that
every save of the previewed document raises and that nothing ever clears — so
from the first save on, every message carried it. The runtime read each one as a
fresh drawer edit: `skipUnchanged` was off for the rest of the session, every
binding was rewritten on every keystroke, and `relationshipUpdate` fired once per
keystroke with an event that named the previewed document itself.

The update now re-renders, and the event now fires, only when the document event
changed since the last message _and_ names a document other than the one on the
page. A message that does not say which document it previews still takes the
event at its word — once. Replaying the recorded Payload 3.88 session
(`tests/fixtures/wire-corpus/payload-3.88.0.json`, which crosses a save): four
`relationshipUpdate` events become none, and the writes after the save go from
none skipped to thirteen.
