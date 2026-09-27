---
'payload-live-preview': patch
---

When `scopeBindingsByOwner` is enabled, unsaved fields and island update events now stay within the current document's owned subtrees. Normal and late fragment rendering, fragment fallback, unfaithful-patch escalation, island replay, and late fieldless route markers apply the same fail-closed owner check; behavior remains unchanged when owner scoping is disabled.
