---
'payload-live-preview': minor
---

The keyed morph takes its ownership rule as an option. `MorphOptions.boundary` (Experimental, `/structural`) names the subtrees the morph never enters; the package's rule — custom elements, islands, `contenteditable`, `data-payload-owned` — is the default and what the structural applier, the fragment strategy and the route strategy hand in. A supplied rule replaces the default; the now-Experimental `isMorphBoundary` export lets another coordinator extend the package rule instead of copying it. Compatible owned roots now stay untouched, while keyed owned elements with a different tag or namespace are replaced as ADR 0008 requires. The engine itself only pairs, edits and keeps focus (ADR 0008 §9).
