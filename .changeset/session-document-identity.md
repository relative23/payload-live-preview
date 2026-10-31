---
'payload-live-preview': minor
---

`useLivePreviewDocument()` from `payload-live-preview/react` and `payload-live-preview/vue` takes a `document` option, `{ collection, id }` or `{ global }`, with an optional `locale`. A hook given one merges only the updates for that document. An update for another document no longer starts a request, aborts the merge in flight or replaces the data: before, a second hook started from `pages/2` showed `pages/1` after the admin's first update for `pages/1`. An update that does not say which document it is for is left alone as well, with one warning per hook in development; Payload 2 sends no collection or global slug, so leave `document` out there. A changed `document` replaces the session, like the other options. Without `document` a hook follows every update, as before.
