---
'payload-live-preview': patch
---

An element the runtime cannot patch faithfully (`LP0402`, `LP0411`) is escalated again when a later revision brings a new value for it. It used to be handed to the fragment or route strategy once per element and never again, so after the first edit of, say, a heading that holds a `<span lang>`, later edits stayed out of the preview even after the save. A new value is now handed over again, at most once a second per element; never with the value it was last handed over with, because the re-apply after a route render gives that value to the renderer again. `LP0411` is still said and `inspect().fidelity.unfaithful` still counted once per element; `escalated` counts every handover, so it can now pass `unfaithful`.
