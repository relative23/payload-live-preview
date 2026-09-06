---
'payload-live-preview': minor
---

Add `payload-live-preview/lean`: a smaller runtime artifact for pages that need
less.

```ts
import { LEAN_RUNTIME } from 'payload-live-preview/lean';

livePreview({ runtime: LEAN_RUNTIME, allowedOrigins: [ADMIN] });
```

24 763 bytes gzip against the full runtime's 30 253. It leaves out the fragment
and route strategies, the keyed morph, the structural arrays, the item templates
and the screen-reader announcer; everything else is the same runtime — the same
message bus, origin rules, merge and renderers for text, numbers, dates, images,
uploads, relationships and rich text.

A page that needs one of the omitted features is told so once, with LP0104, and
its markup is left exactly as the server rendered it. Never half-applied, never
silent. The two strategies and the lean artifact exclude each other outright, and
the generator refuses that combination rather than emitting a prelude with
nothing to talk to.

It is an imported value rather than a `profile: 'lean'` option because that is
what keeps it free for everyone else: measured on this package, a string option
put the second artifact into every adapter entry and grew each by 24 KB gzip.
This way the bytes follow the import.
