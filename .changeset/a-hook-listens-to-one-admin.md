---
'payload-live-preview': major
---

A hook session listens to the admin that spoke first (ADR 0007, row 39). `useLivePreviewDocument()` in React and Vue and `createDocumentSession()` lock onto the origin of the first update they accept for their document, and refuse an update from any other origin on `allowedOrigins` until the last subscriber leaves. The inline runtime and `LivePreviewClient` have always done this; a hook took updates from every allowed origin for as long as it listened, so with two admins on the list the second could write into a preview the first had opened.

- With one allowed origin nothing changes.
- An update the session leaves alone, for another document or locale, decides nothing.
- There is no option. A page that two admins drive in turn is opened from the one that edits.
