---
'payload-live-preview': minor
---

Add `routeStrategy`, so a page can refresh its route without configuring a
fragment endpoint.

The route strategy used to arrive only inside the fragment prelude, and the
generator emitted that prelude only for a page with a `fragmentEndpoint`. A
binding marked `data-payload-strategy="route"`, or one in `<head>`, therefore
did nothing outside Astro — the one framework with a `createFragmentEndpoint()`
helper.

`generateInlineScript({ routeStrategy: true })` and the same option on every
adapter now emit a second, smaller prelude carrying the route strategy alone:
2 068 bytes gzip against the fragment prelude's 3 791. Setting both is not a
double cost — `fragmentEndpoint` wins, because its prelude already contains the
route strategy.

A page that sets neither is unchanged apart from 36 bytes gzip: the runtime now
looks for the second prelude as well.
