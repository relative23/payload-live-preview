---
'payload-live-preview': major
---

A hook names the document it previews (ADR 0007, rows 26 and 31).

- `document` is required on `useLivePreviewDocument()` (`/react`, `/vue`) and `createDocumentSession()` (`/core`): `{ collection, id }` or `{ global }`, with an optional `locale`. A hook merges only the updates for that document. One without `document` does not start and says what to name.
- `document: 'any'` follows whichever document an allowed admin sends, which every hook did in 2.x. It is for a page that renders whatever the admin edits, a create screen for one.
- A hook with a `locale` leaves alone an update that names no locale, as `requireLocale: true` did since 2.4. `requireLocale: true` is still taken and `requireLocale: false` is refused; where the admin sends updates without a locale, leave `locale` out of `document`.
- The development notices for a hook without `document` and for a merged update without a locale are gone.
