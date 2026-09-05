---
'payload-live-preview': minor
---

`payload-live-preview/server` is the privileged, server-only surface.
`definePreview({ serverURL, depth })` binds the Payload origin and **one**
population depth shared by the initial read and the runtime merge
(`runtimeOptions` spreads into any adapter). Its `fetchDocument()` /
`fetchGlobal()` take the authorization — or `null` — as the explicit draft
decision, accept an `AbortSignal`, time out, and report failure as a typed
result, or throw `PreviewFetchError` under `errorMode: 'throw'`;
`onDiagnostic` receives every failure for logs. The subpath re-exports
`authorizePreviewRequest`, `issuePreviewToken`, `hasPreviewIntent` and the
binding helpers, so a server file imports one thing, and no browser bundle can
reach it.

The root-entry `fetchPreviewDocument()` / `fetchPreviewGlobal()` are removed;
`pll migrate` rewrites each call to `definePreview()`.
