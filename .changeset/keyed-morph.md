---
'payload-live-preview': minor
---

Keyed DOM morph for structural updates (ADR 0008). A changed item keeps its
live element and is edited toward the re-rendered markup, so focus, text
selection, typed values, scroll position, playback, a visitor-opened
`<details>` and the listeners the site attached all survive an update.
Children pair by `data-payload-key` / `data-payload-nested-key`, else by
position; `open`, `value`, `checked` and `selected` are touched only when the
template names them. The morph never enters a custom element, `astro-island`,
`data-payload-island`, `contenteditable` or `data-payload-owned` subtree.
Missing, duplicate and unstable keys are reported once per container
(`LP0404`–`LP0406`) and degrade to positional pairing. Item templates may now
contain form controls, `<details>`, media and custom elements
(`sanitizeHtml(html, { allowFormControls: true })`, used only for author
templates — every interpolated value is escaped first). Proven in three
browsers; measured at +7 % (~30 µs) on one changed item of 100 and equal on
reorders, recorded in `docs/benchmarks.md`.
