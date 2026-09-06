---
'payload-live-preview': patch
---

Docs: one page that says what the package is, and a reason beside every option.

`docs/architecture/overview.md` is the map the decision records never had: two screens and the one message that crosses between them, the five objects that answer the two hard questions — the decision, the authorization, the binding, the strategy, the runtime — the three strategies with when each is the right one, and one line of justification for every rule the records expand on, each linked to its record. `docs/options.md` gains the same treatment from the other side: the forty-five rows are grouped into the eight decisions they actually represent, so the table reads as eight questions rather than a list.

Two types are gone, both concepts with no remaining reason: `PreviewBindingsCommonOptions`, a one-member base left behind when its sibling options type was removed in 2.0, and `AnnotatableEntry`, which had one member and one use. The public surface is five declarations smaller than before this pass.
