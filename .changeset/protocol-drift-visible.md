---
'payload-live-preview': minor
---

Make protocol drift visible: LP0503 in the browser, and an issue from the weekly
watch.

This package mirrors Payload's postMessage protocol by hand and has no `payload`
dependency, which is what lets it run on Astro, static pages and plain HTML. The
price is that a newer admin can send something this runtime does not recognise —
and until now such a message was dropped in silence, which from the outside looks
exactly like "live preview stopped working".

Now a message from an origin the page already trusts that misses the expected
shape, or carries a type this version has no meaning for, prints LP0503 once with
the origin and which of the two it was. Once per page: a drifting sender repeats
the same shape on every keystroke, and thirty identical lines would hide the rest
of the console. An untrusted origin still says nothing — that is a refusal, not
drift.

The weekly protocol watch, which executes the published Payload client and
asserts the behaviours this package relies on, now files what it found as a
GitHub issue instead of only turning a scheduled run red. It updates the open
issue rather than opening a second one, and only for the `latest` matrix entry:
`canary` churns before it stabilises, and an issue per pre-release would train
everyone to ignore the label.
