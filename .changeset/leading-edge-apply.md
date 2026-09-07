---
'payload-live-preview': minor
---

A keystroke now reaches the preview in one animation frame instead of after the
whole `debounceMs` window.

The debounce exists to coalesce a burst of messages into one write, and the
first message of a quiet phase is not a burst: it was waiting for a window with
nothing in it to coalesce. The scheduler now applies that first write on the
next frame and opens the window from there, so everything the burst brings after
it is still batched exactly as before. Measured in jsdom against the runtime's
own interaction gate, one isolated keystroke: **66.6 ms p95 → 16.6 ms p95**, and
the same on a rich-text and a relationship field.

This is only worth having because `dataMerge` no longer asks Payload on every
message: a leading write that had to wait for a REST round trip would be a frame
plus the network. For the common edit — typing into a text field — there is now
no request and no window between the keypress and the page.

Nothing to configure. `debounceMs` keeps its meaning for the burst, and
`debounceMs: 0` behaves as it always did. A field that only the server can
resolve still shows what the message carried until the shared answer lands, and
is replaced when it does.
