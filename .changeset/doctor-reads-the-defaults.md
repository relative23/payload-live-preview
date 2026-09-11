---
'payload-live-preview': patch
---

`pll doctor --v2` no longer reports four readiness gaps on every 2.0 page. It read an empty slot of the inline configuration as the 1.x value, while the 2.0 runtime runs the 2.0 one. The inline script now names the defaults it was generated against, and the doctor reads that instead of guessing; a script without it — from 1.x or `2.0.0-beta.0` — is still read as 1.x, and the report says so.

`generateInlineScript({ defaults: 'v1' })` restores the 1.x runtime rows, as documented. It wrote the same configuration as the 2.0 default before, so a page built by hand ran the strict sanitizer, skipped unchanged bindings, accepted only its parent or opener and ignored the referrer, although it had asked for 1.x. The adapters resolved the profile themselves and were not affected.
