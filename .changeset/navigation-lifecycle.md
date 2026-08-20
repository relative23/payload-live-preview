---
'payload-live-preview': minor
---

Own the document lifecycle instead of leaving it to every integration. `LivePreviewClient` gains `suspend()` and `resume()`, and `bindNavigationLifecycle()` wires them to `pagehide` and a persisted `pageshow`. A back/forward-cache restore does not re-run module scripts, so a client that stays attached across `pagehide` comes back bound to a document the browser froze and thawed, and silently stops updating. Unlike `destroy()`, a suspension keeps plugins, renderers and transforms, so the same client comes back. Soft-navigation cache rebuilds are opt-in per event name, because the package cannot know which framework is present.
