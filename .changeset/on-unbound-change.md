---
'payload-live-preview': minor
---

Add `onUnboundChange`, so an edit to a field the page does not bind is no longer
invisible.

Patching reaches what the markup annotates. Until now a revision that changed a
field with no `data-payload-field` anywhere did nothing at all: the preview kept
showing the old value with no sign that anything had happened. A framework hook
that re-renders the whole component tree has no such failure mode, and that was
the one thing the official React and Vue packages did better.

`onUnboundChange: 'route'` refreshes the route for such a revision instead.
Where a binding exists the page is still patched in place, focus and scroll
intact; only the change nothing covers costs a refresh. The default stays
`'ignore'`, so nothing changes for an existing setup.

A binding on the field, on its locale-suffixed name, or on a path inside it
(`hero.eyebrow` covers the field `hero`) all count as covered. The fields Payload
sends with every document are never counted, and the connection's first message
is skipped — there every field looks changed and the page has just been rendered
from them. The refresh reports `LP0807`.
