# Show-and-tell draft (Payload Discord / GitHub Discussions)

> Post manually — do not automate. Suggested target: Payload Discord
> `#show-and-tell`, and a GitHub Discussion in the payload repo if
> appropriate.

---

**payload-live-preview — live preview for Astro, SvelteKit, Nuxt & static sites**

The official `@payloadcms/live-preview-react`/`-vue` hooks are great when React/Vue re-renders your page — but for Astro, server-rendered SvelteKit/Nuxt, or plain static HTML there was no ready-made client. This package fills exactly that gap:

- Annotate your server-rendered markup with `data-payload-field` attributes — the runtime patches the DOM in place on every admin keystroke. No hydration required.
- Speaks the stock Payload 3.x postMessage protocol (verified against `@payloadcms/live-preview` source; a weekly CI job watches for wire-format drift, including 4.0 canaries).
- Populated relationships via the same REST-merge strategy as the official client — plus debounce and stale-request abort.
- Full Lexical renderer (16 node types) with an `<RichText />` Astro component so SSR markup and live patches come from the same renderer.
- Intent-gated server adapters can avoid preview bytes on requests without configured preview signals and merge (never clobber) CSP `frame-ancestors`. Query/iframe/referer signals are not authorization; protected draft, cache, CSP and injection decisions stay application-owned.
- Escape-by-default sanitizer, URL/srcset validation, and an origin allow-list that locks after the first accepted data-bearing update.
- E2E-tested against real Astro 7, Next.js 16 and SvelteKit 2 apps in three browsers, with an extensive unit/integration regression suite.

Honest scope: for client-rendered React/Vue apps, keep using the official hooks — this is for everything they don't cover.

GitHub: https://github.com/relative23/payload-live-preview
npm: https://www.npmjs.com/package/payload-live-preview

Feedback and issues very welcome.
