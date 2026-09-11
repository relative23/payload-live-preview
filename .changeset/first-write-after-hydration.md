---
'payload-live-preview': minor
---

On a Next.js page the runtime's first write no longer lands before React has
hydrated. Measured on the example: the runtime started on `DOMContentLoaded`,
the admin answered `ready` at once, and the document was written 81 ms before
React walked the server markup — React threw `Hydration failed because the
server rendered text didn't match the client`, regenerated the tree on the
client and dropped the write, once per page load.

Every script the Next.js adapter emits now declares `hydration: 'react'` — a
new inline option, wire slot 23, unset everywhere else — and under it the
runtime does not start (no `ready`, no listener) until React has committed the
tree that holds the bindings, observed through React's instrumentation hook
(`__REACT_DEVTOOLS_GLOBAL_HOOK__`, wrapped when a DevTools extension already
owns it). A page whose React never commits starts after five seconds and
reports `LP0607`; `inspect().hydration` reads `waiting`, `committed` or
`timed-out`. Under asset delivery the bootstrap is a build that arms the
observation before it fetches the runtime, which may otherwise arrive too late
to be injected into. ADR 0015 records the decision and its failure modes.
