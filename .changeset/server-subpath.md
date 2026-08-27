---
'payload-live-preview': minor
---

`payload-live-preview/server`: the privileged, server-only surface.
`definePreview({ serverURL, depth })` binds the Payload origin and **one**
depth shared by the initial read and the runtime merge (`runtimeOptions`
spreads into any adapter); `fetchDocument()` / `fetchGlobal()` take the
authorization verdict as their explicit draft decision, accept an
`AbortSignal`, time out, and report failure as a typed result — or throw
`PreviewFetchError` on request — with an `onDiagnostic` hook for logs. The
subpath also re-exports `authorizePreviewRequest`, `issuePreviewToken`,
`hasPreviewIntent` and the binding helpers, so a server file imports one
thing. The architecture policy keeps every browser bundle from reaching it.
The root-entry `fetchPreviewDocument()` / `fetchPreviewGlobal()` are
deprecated (ADR 0007, entries 9 and 10) and keep their 1.x behaviour.
