---
'payload-live-preview': patch
---

Route refresh now reconciles the ordered managed head output without collapsing repeated metadata. It removes stale attributes and surplus managed tags while leaving scripts, styles, CSP metadata and elements marked `data-payload-owned` untouched.
