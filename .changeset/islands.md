---
'payload-live-preview': minor
---

Island interoperability (roadmap 1.3.0). A hydrated island — `astro-island`,
or any element marked `data-payload-island` — owns its subtree: the runtime
does not patch bindings inside it and the keyed morph never enters it.
Instead every applied update is dispatched on each island root as a
`payload-live-preview:update` DOM event (`detail: { fields, revision,
receivedAt, locale }`) for the island's own code to apply; islands on
Payload's official `useLivePreview` hook need nothing and are left alone.
`data-payload-island="patch"` opts an island into patching. Proven in three
browsers.
