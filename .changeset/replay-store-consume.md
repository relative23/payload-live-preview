---
'payload-live-preview': minor
---

The replay store for `signed-token` is one atomic `consume(id, expiresAt)`.

The 1.x store was two calls, `isUsed` and then `markUsed`, and a review of
1.8.1 named the consequence: two requests carrying the same token that arrive
together both pass `isUsed` before either reaches `markUsed`, so the optional
replay protection did not protect against the one case it exists for. The
package cannot make two calls one step, so the contract is now one call: the
store checks and records at once (Redis `SET NX PX`, a unique insert) and
answers `true` when this use was the first. Any other answer refuses the token
as `replayed`, a throw as `unavailable`.

The `isUsed`/`markUsed` shape is still accepted as `PreviewTokenReplayChecks`,
deprecated with the race stated in its notice, and removed in 3.0. A unit test
pins both halves: the atomic shape admits exactly one of two simultaneous
requests, the deprecated one admits both.
