---
'payload-live-preview': patch
---

A drawer edit reaches the page even when the panel supersedes the message that
carried it.

Payload posts `externallyUpdatedRelationship` twice for one drawer save, back to
back. The runtime reads the event as an edge, so it is news on the first of the
two messages: that revision forces the re-render and asks the server for the
populated document. The second message is the repeat — it forces nothing and
asks nothing — and it supersedes the first before the answer arrives. The
populated document was then dropped with the revision that ordered it, and the
page kept the values from before the drawer was opened.

Measured against Payload 3.88 with `mergeDepth: 1` and a global whose `author`
points at another collection: three revisions accepted, one superseded, two
requests sent, and every write on the page belonged to the repeat and carried
the old name; the answer to the second request had the new one. The obligation
to render now passes from a superseded revision to the one that supersedes it,
and stops at the revision that completes — so the repeat asks, and the name the
editor just typed lands. `relationshipUpdate` still fires once per drawer save.
