---
'payload-live-preview': minor
---

Add the fragment endpoint to the SvelteKit and Nuxt adapters, and a gated
`boundary()` helper for the markup that marks one.

Server-rendered boundaries now exist for every framework this package adapts.
The endpoint itself is the same code as before — authorization, protocol,
limits, registry — and each adapter binds one renderer to it:

| Framework | Import                           | Renders with          |
| --------- | -------------------------------- | --------------------- |
| Astro     | `payload-live-preview/astro`     | `astro/container`     |
| Next.js   | `payload-live-preview/nextjs`    | `react-dom/server`    |
| SvelteKit | `payload-live-preview/sveltekit` | `svelte/server`       |
| Nuxt      | `payload-live-preview/nuxt`      | `vue/server-renderer` |

```ts
// src/routes/payload/fragment/+server.ts
export const POST = createFragmentEndpoint({
  authorizePreview,
  registry: { hero: { component: Hero, props: ({ fields }) => heroProps(fields) } },
});
```

`svelte` and `vue` join `astro`, `react` and `react-dom` as optional peers,
imported at the first render. Nuxt's binding takes a `Request` — what
`toWebRequest(event)` makes of an H3 event — so this package needs no `h3`
dependency to describe its own signature. Svelte's binding delivers `render()`'s
`body` only: `<svelte:head>` output belongs to the document head, which the route
strategy owns.

`createPreviewBindings().boundary('hero', { dependsOn: ['title'] })` writes the
boundary attributes under the same authorization gate as `bind()` — a registry id
and the fields it depends on describe the content model as much as a field name
does — and refuses an id the endpoint would refuse, instead of leaving a boundary
that silently never renders.

Two notes the guides now carry, both learned from the fixtures: Svelte's server
renderer keeps its component context in a module variable, so the binding imports
`svelte/server` by name and the consumer's bundler resolves it in the same graph
as the components; and Nitro's rollup needs `@vitejs/plugin-vue` to read a
single-file component inside the server bundle.
