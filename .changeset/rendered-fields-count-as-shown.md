---
'payload-live-preview': patch
---

A field that only a fragment boundary or a route-bound element shows, through `data-payload-depends`, no longer counts as unbound when the page has the strategy that renders it. An edit of such a field used to refresh the whole route before the boundary rendered anyway, and `inspect().fidelity.fields` and the unbound-fields overlay listed a field the page did show. The rule is the planners' own: a named `data-payload-fragment` boundary, or an element marked `data-payload-strategy="route"`, or a binding in `<head>` without a strategy. A boundary inside an island still does not count, and neither does anything when the strategy is missing.
