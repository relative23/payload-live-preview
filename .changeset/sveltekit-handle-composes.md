---
'payload-live-preview': patch
---

`livePreviewHandle` composes with SvelteKit's own `Handle` type.

The returned handle declared a fixed shim for the request event, which worked
one way only: SvelteKit's real `RequestEvent` is assignable to the shim, but its
`resolve` — which takes that real event — is not assignable to a resolve that
takes the shim. Wrapping the handle in one of your own therefore failed to
compile even though every value matched. It is generic in the event now, and the
event passes through untouched.

The adapters also declare what they write to a framework's request context
(`LivePreviewLocalsSink`) instead of `Record<string, unknown>`: an `App.Locals`
interface has no index signature, so it was not assignable to a record.
