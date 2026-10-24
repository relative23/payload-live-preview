---
'payload-live-preview': patch
---

The guides are brought in line with the 2.1.0 code. The fragment guide names the Astro jobs that run on every push, the host router refresh (`registerRouteRefresh()`, `<LivePreviewRouteRefresh>`), the 404 and 403 answers of the endpoint, the 64-character id limit and the diagnostics `LP0807` to `LP0810`. The options reference names the options of `useLivePreviewDocument()`, `withLivePreview()` and `createFragmentEndpoint()`. The Next.js guide no longer says that `manageCsp: 'full'` covers the asset bootstrap: the nonce it writes into the header never reaches the layout's script. The React guide says which option changes start a new session, the deployment guide names `/plugin` for the Payload side of a monorepo, and the testing pages carry the current mutation ceilings, tree-shaking budgets and advisory counts. The README's local release checks are dated to the run on the published 2.1.0 archive. Documentation only.
