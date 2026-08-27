---
'payload-live-preview': patch
---

A wire corpus: messages captured verbatim from real Payload admins (3.85.0
and 3.88.0) live under `tests/fixtures/wire-corpus/`, are replayed through
the runtime in tests, and are checked by the weekly protocol watch against
the official client. The README compatibility table carries one row per
capture; `npm run compat:check` keeps table and corpus in step. The bug
report template asks for update strategy, authorization mode and the
`__livePreview.inspect()` output.
