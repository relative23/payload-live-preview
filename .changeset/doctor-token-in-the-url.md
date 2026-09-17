---
'payload-live-preview': patch
---

`pll doctor` audits a signed-token preview the way the strategy reads the token.

2.0.1 suggested `--header "x-preview-token: …"`, but the `signed-token` strategy reads the token from `?previewToken=` unless its transport is `{ kind: 'header' }`, so that advice audited a refused request. Pass the token in the URL instead; the visitor request now drops `previewToken` along with the intent parameters, so it stays anonymous and a replay store does not spend the token on it. `--header "Cookie: payload-token=…"` remains the way to audit a Payload session.
