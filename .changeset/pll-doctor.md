---
'payload-live-preview': minor
---

Add `pll doctor`, an audit of what a deployment actually serves. `inspect()` answers "what is this runtime doing right now" from inside the page; the doctor answers the question one step earlier, from outside it.

`npx pll doctor <url> --admin <origin>` fetches the URL twice — once as an ordinary visitor, once with the headers the admin's iframe sends — and reports the difference. That comparison is the whole design. A configuration file can say `allowedOrigins: [...]` while a proxy strips the header, an adapter runs in an inject mode nobody remembers choosing, or a build emits binding attributes on public pages; the gap between what a project believes it is configured to do and what it puts on the wire is where this package's most expensive findings have lived.

Verified against a real same-origin consumer before release, which immediately paid for itself: the first run produced three findings and all three were wrong for that topology. `'self'` in `frame-ancestors` does name the admin when admin and site share an origin, `X-Frame-Options: SAMEORIGIN` does permit that framing, and a missing inline runtime is expected when the consumer starts `LivePreviewClient` themselves. All three are corrected and pinned by regression tests; a missing runtime is now a warning that names both readings rather than an error that assumes one.

Seven checks, each stamped with a code: no runtime in the preview response, a missing `frame-ancestors` or one that excludes the admin origin, an `X-Frame-Options` that no CSP can undo, binding attributes served to anonymous visitors, more bindings than the visibility gate writes eagerly, bindings outside every owner marker, and a runtime with nothing to write into. Exit code 2 on any error-level finding, so it drops into CI against a deploy preview; `--json` emits the report as data.

`analyzeProbe()` is exported from `payload-live-preview/doctor` for callers who fetch the responses themselves — the judging is pure, and only the fetching lives in the CLI. The audit makes exactly the two requests it is told to make, sends no credentials, and reports no telemetry.
