---
'payload-live-preview': patch
---

A fragment that falls back to a patch now says so on the debug log, not only on
the `error` event.

`LP0801` is documented as a code that appears in log output _and_ on the `error`
event, and `debug: true` is how a page asks to see it. It never appeared:
`context.failed(...)` emitted the two events and logged nothing, and the one
`deps.log(…, 'LP0801', …)` in the strategy runner sat in the `catch` around the
strategy's `render()` — a path the supplied fragment strategy never takes,
because it answers a timeout, an invalid response or a refusal with an outcome
instead of throwing. Measured with a 60 ms timeout against an endpoint that
never answers: `inspect().fragments.failed` 1, an error event carrying LP0801,
and not one line in the runtime's log sink or on `console.debug`.

The line is written where the failure happens, so LP0801, LP0802 and LP0803 each
reach the log with the boundary and the reason they belong to.
