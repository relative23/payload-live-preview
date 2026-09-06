---
'payload-live-preview': patch
---

The strict-mode refusals name the staged path.

`strict` is the default since 2.0, and its three startup errors — a missing `authorizePreview`, an empty `allowedOrigins`, a non-https admin origin in production — stop a process that worked on 1.x. Each stated its rule and nothing else, which left an upgrader to discover on their own that a staged path exists.

They now end with it: `defaults: 'v1'` keeps the 1.x table while you migrate, and `docs/migration.md` has the rest. The rules are unchanged; the way out is in the message that stops you rather than only in a guide you have not opened yet.

Together with `LP0409` and `LP0501`, this closes the three shapes a 1.x project meets on upgrade: an option whose default flipped in silence, a message quietly refused, and a process that refuses to start.
