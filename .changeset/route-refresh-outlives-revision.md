---
'payload-live-preview': patch
---

A route refresh that is still running when the next revision arrives now lands for that revision: the runtime rebuilds its cache and re-applies the current revision on the fresh markup. Before, the newer revision cancelled the refresh, and when it repeated the previous values or changed only a patched field it asked for no refresh of its own, so the unbound change was never rendered. Only a revision that asks for a refresh of its own, a navigation or a stop ends a running refresh; `RouteContext.signal` and `isCurrent()` now say that. A fragment render a newer revision aborts is rendered again by the next revision, even when that revision's changes lie outside the boundary. A throw while the page is re-applied after a refresh is now logged as `route refresh failed` instead of surfacing as an unhandled rejection.
