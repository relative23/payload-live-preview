---
'payload-live-preview': patch
---

Report the first flush the visibility gate holds back. The scheduler stops writing offscreen elements once the binding cache exceeds `visibilityGateThreshold` (default 50) and buffers them until they scroll into view; nothing said so, and the symptom — a page that stops updating below the fold the moment it crosses the threshold — is indistinguishable from a broken runtime. Behaviour is unchanged: the knob already existed, it was simply invisible, and the one code path that saw the deferral returned early on the flushes worth reporting.
