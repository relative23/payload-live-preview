---
'payload-live-preview': minor
---

`LP0501` is said out loud when a message is refused for coming from the wrong window.

`eventSourcePolicy` is `'parent-or-opener'` by default since 2.0, where 1.x accepted any window on a trusted origin. An arrangement whose admin posts from somewhere else — a custom integration, a sibling frame, a harness — therefore stops updating on upgrade, and the refusal only ever reached the debug log, which is off in production and in most development. From the outside that looks like "live preview is broken", with nothing to go on.

It is now reported once per page, naming the option, its 2.0 default and the 1.x behaviour, the same way `LP0503` reports protocol drift. No new code and no behaviour change: the message stays refused, and `eventSourcePolicy: 'any'` restores the old policy.

This is the second of the three defaults 2.0 flipped in silence; `LP0409` covers the sanitizer. The third, `skipUnchanged`, deliberately gets no report — it skips writes whose value did not change, which is a cost decision rather than a visible one, and `inspect().revisions.skippedUnchanged` counts them.
