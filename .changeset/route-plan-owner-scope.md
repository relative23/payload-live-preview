---
'payload-live-preview': minor
---

With `scopeBindingsByOwner`, a route marker or a route binding that belongs to another document no longer triggers a route refresh for the edited document. `RouteStrategy.plan` receives a third argument, `context.inScope(element)`, which says whether an element belongs to the update; `createRouteStrategy()` uses it, and a custom planner with two parameters keeps working as before. The new `RoutePlanContext` type is exported next to `RouteStrategy`.
