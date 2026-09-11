---
'payload-live-preview': minor
---

When the runtime knows a patch cannot reach what the server would have drawn, it
now asks a server to draw the region instead of leaving the degraded patch on the
page. Three findings reach that decision:

- a renderer that refused the value it was handed — an element with structured
  children (LP0402), an upload or image whose value carries no usable URL, an
  array renderer given something that is not one — or a field type with no
  renderer at all;
- a Lexical block with no registered renderer whose server markup the write had
  to drop because the live and rendered trees do not line up (the case LP0410
  documents as the one it cannot keep);
- a revision that changes a field with no binding anywhere, which is also how a
  section the template renders only under a condition looks from the page's side.

Each escalates to the fragment strategy when a boundary covers the binding and
to the route otherwise, once per element — a page with neither `fragments` nor
`routeStrategy` has nothing to escalate to and keeps the patch, exactly as
before.

**`onUnboundChange` is renamed to `onUnfaithfulPatch`, and its default changes.**
The new option takes `'ignore' | 'warn' | 'escalate'` and defaults to
`'escalate'`; `'warn'` reports the new **LP0411** and keeps the patch; `'ignore'`
keeps it silently, which is what 2.0 did. `onUnboundChange` still works and still
decides when it is given — `'route'` means `'escalate'`, `'ignore'` means
`'ignore'` — and is removed in 3.0.

A page that configured no strategy sees no change. A page that did, and had left
`onUnboundChange` at its default, will now refresh its route for a change nothing
binds; `onUnfaithfulPatch: 'ignore'` restores the old behaviour.
