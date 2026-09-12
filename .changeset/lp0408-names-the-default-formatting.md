---
'payload-live-preview': patch
---

LP0408 now says what it does: an unknown `data-payload-format` leaves the
renderer's default formatting in place rather than writing the value unformatted.

`data-payload-format="bogus"` on a number binding writes `4,200`, not `4200` —
the renderer's own `Intl` default, because an unrecognised spec only means "no
options from the attribute". The sentence in the code, the generated diagnostic
table, the binding guide and the warning the runtime prints all said
"unformatted". Only the words change; the formatting itself is unchanged.
