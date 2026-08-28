---
'payload-live-preview': minor
---

Reveal the edited section in the preview. With `revealEditedField: true`, when a
field's value changes the preview scrolls that field's bound element into view,
so the section under the editor's cursor is always visible without manual
scrolling — the route strategy already brings up the right page; this brings up
the right section. It is conservative by design: it scrolls only when the target
is off-screen and only when the edited field changes, honours
`prefers-reduced-motion`, and never fights a deliberate manual scroll. Off by
default.

Tier 2 (opt-in): an admin-side helper — `createPreviewFocusReporter` /
`reportPreviewFocus` — lets a Payload field component report the focused field
(`payload-live-preview-focus` message) so the preview reveals a field the cursor
moves into even without typing.
