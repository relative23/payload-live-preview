---
'payload-live-preview': patch
---

`inspect().fidelity` now counts the third cause it always named: a changed field
the page has no binding for at all.

`onUnfaithfulPatch` acts on three causes — a value no renderer can represent, a
Lexical block whose markup the write has to drop, and a changed field with no
binding anywhere. Only the first two reached the ledger: they name an element,
and the counter was reached from the write. The third is decided one step
earlier, where there is no element to write to, so a page that binds `title` and
is sent an edited `tagline` refreshed its route (`LP0807`) and still reported
`{ unfaithful: 0, escalated: 0, fields: [] }` — under every mode, and on a page
with no strategy at all, which is the page the reading exists for.

The finding is now recorded once per field name, under every mode and whether or
not anything can be done about it, and `escalated` counts the ones a route
refresh answered. Nothing else moves: `'warn'` still adds no line of its own
(`LP0201` already names the field), `'ignore'` still keeps the stale value, and
the default still refreshes the route exactly where it did before.
