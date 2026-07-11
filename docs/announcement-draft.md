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
- Preview-gated server adapters: production traffic ships zero preview bytes; CSP `frame-ancestors` is merged (never clobbered) on preview responses.
- Escape-by-default sanitizer, URL/srcset validation, origin allow-list with post-handshake lock.
- E2E-tested against real Astro 7, Next.js 16 and SvelteKit 2 apps in three browsers; ~740 unit/integration tests.

Honest scope: for client-rendered React/Vue apps, keep using the official hooks — this is for everything they don't cover.

GitHub: https://github.com/relative23/payload-live-preview
npm: https://www.npmjs.com/package/@relative23/payload-live-preview

Feedback and issues very welcome.
