---
'payload-live-preview': minor
---

Renderer API and plugin ownership (roadmap 1.2.0). Renderers may register
under namespaced custom keys (`data-payload-type="acme:money"`) without
weakening the built-in field-type safety — an un-namespaced unknown type
still falls back to the heuristics. `LivePreviewClient` accepts
`resolveRenderer(fieldType, target)` for explicit resolution ahead of the
registry and `renderRichText` for a project rich-text renderer shared with
SSR (its output is sanitized; the equivalence with server rendering is
pinned by a test). Plugins may declare `compat: { runtime, protocol }` and are
refused when they do not fit; `inspect().plugins` lists every plugin with its
state and live registrations; the ownership contract — ordering, precedence,
duplicates, rollback, async destroy, return to baseline over 300 cycles —
is under test and documented in `docs/renderers.md`.
