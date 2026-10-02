# ADR 0030 — A Nuxt fragment is a standalone Vue app

**Status:** Proposed • **Date:** 2026-10-02 (H18; measured on `examples/nuxt-payload`
with Nuxt 3.21.11, Nitro 2.13.4 and Vue 3.5.41, and on a copy in Nuxt 4.5.2's
`app/` layout)

## Context

The Nuxt binding of the fragment endpoint renders `createSSRApp(component, props)`
with `renderToString()`, inside the Nitro bundle of a server route. The
component is compiled there by Nitro's rollup with `@vitejs/plugin-vue`, not by
Nuxt's Vite build. Five things follow, each measured:

1. **What a component can reach.** Nitro's own auto-imports reach the compiled
   component: `useRuntimeConfig()` inside it returned the configured value, in
   development and production. Nuxt's app composables do not:
   `useHead()` and `useNuxtApp()` failed with `… is not defined`. Nuxt's own
   islands are isolated the same way: "rendering the component in a new,
   isolated Vue app on the server", with state, provide/inject and `useState`
   not shared with the page
   ([Nuxt 4 documentation, server components](https://nuxt.com/docs/4.x/guide/concepts/server-components)).
2. **A component that throws.** In development Vue rethrows a setup or render
   error and the endpoint answers `500 {"error":"render"}`, so the runtime
   patches the boundary. Vue's production build only logs it and renders the
   component as an empty comment: the endpoint answered `200` with `<!---->`,
   and the boundary was emptied. A browser case in production was red 3 of 3
   (PHD-17) and passed in development.
3. **A `<style>` block.** With the guide's recipe (`nitro.rollupConfig.plugins:
[vue()]`) the server build failed on the first component with a style
   block: rollup read the CSS as a JavaScript module.
4. **Scope ids.** `@vitejs/plugin-vue` hashes a component's scope id from its
   path relative to its root. Nuxt's build uses `srcDir`; outside Vite the
   plugin uses the working directory. On Nuxt 3 the two are the same directory.
   On Nuxt 4's `app/` layout the page carried `data-v-30b0ac3d` and the
   fragment `data-v-523b74a5`, and no scoped rule reached what the fragment
   rendered (red 3 of 3).
5. **The module's config key.** `@nuxt/kit` reads a module's meta through
   `getMeta()` only. The module exposed `.meta` alone, so Nuxt wrote no schema
   entry for it and `vue-tsc` refused `livePreview` in `nuxt.config.ts`.

## Decision

1. **A fragment is a standalone Vue app.** It renders from its props. What it
   would read from Nuxt is read in the route and handed in as props: the
   request's own server context as `locals` (`event.context`, ADR 0029), the
   runtime config, data the page loads. Nuxt's app composables (`useHead`,
   `useNuxtApp`, `useState`, `useRoute`) are not available, as measured for the
   first two; the page owns the head, and a binding in `<head>` uses the route
   strategy. The existing custom `render` stays the seam for an app-level
   provide or plugin a project sets up per request.
2. **A component error fails the render in both builds.** The binding sets the
   app's `errorHandler`, keeps the first error and throws it after the render.
   Development and production then both answer `500` and the runtime patches
   the boundary.
3. **The build recipe is a helper.** `fragmentComponentPlugins(vue, { srcDir })`
   from `payload-live-preview/nuxt-module` returns the rollup plugins for
   `nitro.rollupConfig.plugins`: Vue's plugin with a scope-id hook that hashes
   the path under `srcDir`, as Nuxt does, and a plugin that answers every style
   request with an empty module. The page's build delivers the CSS, because the
   page imports the component (ADR 0029). `@vitejs/plugin-vue` stays the app's
   own dependency and is passed in.
4. **The module exposes `getMeta()`**, so Nuxt writes the `livePreview` key into
   `.nuxt/types/schema.d.ts`.

### Alternatives

- **Render through Nuxt's island endpoint** (`/__nuxt_island`). It would bring
  plugins and an island head. It needs Nuxt's experimental component islands,
  island components declared as such, and a second public renderer beside the
  authorized endpoint. Not measured here; left for a later decision.
- **Keep the recipe as documentation.** Three steps that fail silently (scope
  ids) or at build time (styles) in a pasted snippet; the helper is tested once.

## What counts as failure

**F1 — a component calls a Nuxt app composable.** The render fails and the
boundary is patched from the same revision. In development the endpoint logs
`fragment "…" did not render: useHead is not defined`; in production the 500 is
all there is, as for any adapter's render error, and Vue's own production log
line no longer appears, because the error handler takes the error instead.

**F2 — the page does not import a fragment's component.** Its scoped rules are
not on the page (ADR 0029); measured red 3 of 3 on Nuxt 3.

**F3 — a project passes the wrong `srcDir`.** Scope ids differ again and scoped
rules miss fragment content, as measured on the Nuxt 4 copy before the hook
(red 3 of 3).

**F4 — the module's options are not type-checked under the key.** Nuxt infers
them from `NuxtModule<O>`, and the module's structural `NuxtLike` does not match
Nuxt's own type (`NuxtTemplate.filename` is optional there), so the key types as
`Record<string, any>`. `satisfies LivePreviewModuleOptions` checks them.

## Consequences

- The Nuxt example renders a fragment-only component with scoped CSS, request
  context and runtime config: development 54/54 and production 54/54 on Nuxt 3;
  production 54/54 and `vue-tsc` without errors on the Nuxt 4 copy.
- The Nuxt adapter grows by the error handler; the module entry by the helper
  and `getMeta()`. The budgets move by the measured bytes.
