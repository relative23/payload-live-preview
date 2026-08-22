---
'payload-live-preview': minor
---

Let a running preview explain itself. `inspect()` returns a point-in-time snapshot of what the runtime actually sees — bound and orphaned fields, the document owners on the page, the origin it locked onto, revisions accepted and superseded, the negotiated protocol, and the scheduler's pending and deferred work with the visibility gate's threshold and whether it is currently deferring. It performs no I/O and transmits nothing.

It is reachable where the failures happen: `__livePreview.inspect()` on the global handle every adapter injects, and `client.inspect()` for consumers driving the runtime themselves. Shipping diagnostics to the programmatic client alone would repeat the mistake that made `bindNavigationLifecycle()` unreachable for adapter users in 1.3.0.

The snapshot is not gated to development builds. It discloses nothing that is not already on the page — the trusted origins are inside the injected script, the field names are `data-payload-field` attributes in the DOM — and a preview that only misbehaves on the deployed site is exactly the case where the information is worth having.

Fixed along the way: the protocol negotiation compared only the negotiated version, so a remote party announcing version 1 left `protocol.theirs` as `undefined`, indistinguishable from one that never announced at all.
