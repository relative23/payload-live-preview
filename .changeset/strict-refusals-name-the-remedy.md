---
'payload-live-preview': patch
---

Each `strict` refusal at startup now says what to do about the rule it states. A missing `authorizePreview` names `authorizePreviewRequest(request, strategy)` from `payload-live-preview/server` and `docs/authorization.md`; empty `allowedOrigins` shows the option with an example origin; an `http:` admin origin in production says to name the https origin. Until now the three messages ended only with `defaults: 'v1'`, the 1.x profile that 3.0 removes, and the closing sentence now says so.
