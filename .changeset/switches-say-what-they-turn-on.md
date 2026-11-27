---
'payload-live-preview': major
---

Three switches are named by what they turn on: `disableVisibilityGate` is `enableVisibilityGate` (default `true`), `disableReferrerDetection` is `enableReferrerDetection` (default `false`) and `disableLocalhostMatching` is `enableLocalhostMatching` (default `true`), each with the value turned round (ADR 0007, row 38). `npx pll migrate ./src --write` rewrites a literal `true` or `false` and lists any other value for a human, because a value that may be `undefined` meant the default under the old name. An adapter, `generateInlineScript()` or a client given an old name refuses to start and names the new one. Behaviour does not change: the defaults are the same ones under the new names, and `useLivePreviewDocument()` and `OriginDetector` already spelled the two origin switches this way. `pll doctor` reads a page that 2.x served as before.
