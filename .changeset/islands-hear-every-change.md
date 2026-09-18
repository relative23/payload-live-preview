---
'payload-live-preview': patch
---

Hydrated islands receive `payload-live-preview:update` for every revision that carried a change, whether or not a binding outside the islands was written. A page whose bindings all sit inside islands never got the event, and with `skipUnchanged` neither did a field only an island shows.
