---
'payload-live-preview': major
---

On a page a framework hydrates, no route strategy fetches the route and morphs it in any more (ADR 0007, row 47). `routeStrategy: true`, `'after-save'` and the route a fragment endpoint brings refresh through the route refresh the page lent, as the default `'router'` does: `LivePreviewNavigation` in Next.js, `livePreviewNavigation()` in SvelteKit, the module in Nuxt. A page that lent none is left as it is, and LP0808 names what to render.

- It applies where the page has a hydration owner: `hydration: 'react'`, `'vue'` or `'sveltekit'`, which the three adapters set. Astro, plain HTML and `hydration: 'manual'` keep the fetch and morph.
- `true` and `'after-save'` still decide when the route is refreshed.
- Why: the morph writes into DOM the framework's reconciler owns, and it takes away every element under `<body>` the fetched HTML does not have. On Next.js 16 that removed `<next-route-announcer>`, the router's own element.
- `pll doctor --v3` names a script-writing call of the three adapters that sets one of the two values.
