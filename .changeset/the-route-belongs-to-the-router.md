---
'payload-live-preview': major
---

The Next.js, SvelteKit and Nuxt adapters hand the route to the router by default (ADR 0007, row 40). `onUnfaithfulPatch: 'escalate'` has been the default since 2.0 and did nothing on a page without a strategy. Where neither `routeStrategy` nor `fragments` is set, these adapters now carry the route strategy as `routeStrategy: 'router'`, a new value: after Payload reports a save, a change no patch can show refreshes the route through the route refresh the page lent, and through nothing else.

- Render `<LivePreviewNavigation />` from `payload-live-preview/nextjs/client` in Next.js, or call `livePreviewNavigation()` from `payload-live-preview/sveltekit/client`; the Nuxt module lends the refresh itself. A page that lent none is left as it is, and `LP0808` names what to render.
- `'router'` never fetches the route and morphs it in. Measured against a real admin, that morph removed Next.js's `<next-route-announcer>` from a page that lent no refresh. `true` and `'after-save'` keep it for a project that asks.
- `routeStrategy: false` keeps no route strategy. A fragment endpoint carries one already and keeps its timing.
- The bootstrap `livePreviewScriptProps()` builds goes to every visitor and stays as small as it was; the Astro integration and `generateInlineScript()` keep no default.
- The cost is the route prelude on a preview page an editor loads: about 8.6 kB raw, 2.6 kB gzip.
- `pll doctor --v3` names a page that sets neither option.
