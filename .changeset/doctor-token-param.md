---
'payload-live-preview': patch
---

`pll doctor --token-param <name>` (`tokenQueryParam` on `runDoctor()`) names the query parameter a `signed-token` strategy reads when its transport is not the default `previewToken`. It is treated like `previewToken`: dropped from the visitor request, counted as the credential, and never printed.
