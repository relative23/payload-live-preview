---
'payload-live-preview': patch
---

Fix: a multiline text field stopped updating after its first update.

The text renderer writes a value containing newlines as `innerHTML` with `<br>`
separators. That gives the element element-children, and the guard that
protects consumer markup — "this element has structured children, refuse rather
than destroy them" — then fired on the renderer's own output. Every later
update to that binding was refused with LP0402, and the field stayed frozen for
the rest of the session while its siblings kept updating.

The guard now ignores `<br>` children specifically. Its purpose is unchanged:
it preserves a styled wrapper around the value, and an element whose children
are nothing but line breaks is not a wrapper — it is the value. A real wrapper
appearing later is protected exactly as before.

Found in a real Payload Admin: the failure reproduced three times across
roughly a thousand browser rounds, always on the one document whose seeded
quote contained a paragraph break, in both locales.
