---
'payload-live-preview': minor
---

The runtime says so when it writes a different reading of a date, a number or
a checkbox than the template printed. On the first write to such a binding —
and only when it carries no `data-payload-format` — the preview holds what the
element showed against what it is about to show, and reports `LP0412` once if
they differ, naming both readings.

It is a diagnostic and nothing else: the value is still written, no strategy is
asked for a re-render, and a page under `onUnfaithfulPatch: 'ignore'` hears
nothing. There is no way for the runtime to tell "the template formatted this
differently" from "the field was edited before the preview connected", so the
message names both and points at the one attribute that settles either.
