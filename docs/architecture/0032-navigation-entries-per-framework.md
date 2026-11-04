# ADR 0032 — Each framework with a client router gets a navigation entry

**Status:** Accepted • **Date:** 2026-11-03

Adds three entries, which ADR 0012 asks to be argued: `payload-live-preview/nextjs/client`,
`payload-live-preview/sveltekit/client` and `payload-live-preview/nuxt/client`.

## Context

A preview page on a framework with a client router needs two things the server adapters cannot
give it: the runtime has to hear when a client navigation has committed (ADR 0028 and the 2.1
navigation work), and the route strategy should be lent the router's own refresh instead of
morphing fetched HTML over the reconciler's nodes. Up to 2.3 the package shipped only the event
name and `registerRouteRefresh()`. Each guide had the project copy the rest. Measured on main
7efa4c4f, non-empty lines without comments in the guide's code block: Next.js 20, Nuxt 29,
SvelteKit 16. The examples carried the same code: two Next.js components (25 and 13 non-empty
lines), a Nuxt plugin per Nuxt major (37 each) and a SvelteKit bridge per Kit major (20 and 21; the
Kit 3 copy also skips a shallow `goto`, which keeps the rendered route).

Copied glue drifts: the Kit 3 guard existed only in one example, and nothing tested the guide's
code.

## Decision

One small client entry per framework, each importing only what its framework resolves there:

- **`./nextjs/client`**: `<LivePreviewNavigation />`, a `'use client'` component that reads
  `usePathname()`, `useSearchParams()` and `useRouter()` from `next/navigation`, dispatches the
  navigation event when the committed URL changes, renders `LivePreviewRouteRefresh` with
  `router.refresh`, and wraps itself in a Suspense boundary because `useSearchParams()` suspends a
  prerendered route. `next` becomes an optional peer with the range `*`. npm checks a peer with
  `semver.satisfies`, which leaves a canary such as `16.5.0-canary.39` outside `>=15.5.0`, the
  range first chosen: `npm install next@canary` beside the package then ended in ERESOLVE (Latest
  Watch, 2026-11-04). Only `*` admits every version. The supported floor stays Next.js 15.5
  (ADR 0031), as a documented promise rather than a range npm enforces.
- **`./sveltekit/client`**: `livePreviewNavigation({ afterNavigate, invalidateAll })`. SvelteKit's
  functions are passed in; `onMount` and `tick` come from `svelte`, already an optional peer.
- **`./nuxt/client`**: `bindNuxtNavigation(nuxtApp, refreshNuxtData)`, called by a client plugin
  the Nuxt module now generates into `.nuxt/` and registers itself. The generated file imports
  Nuxt's composables from `#app`. A project that still has the guide's
  `plugins/payload-live-preview-navigation.client.*` keeps it: the module registers nothing beside
  it and says so once in development, since two plugins would dispatch every commit twice.
  `navigation: false` switches the module's plugin off.

After the change the guides show 2 lines for Next.js (an import and the element), 0 for Nuxt and
3 lines of code for SvelteKit. The built entries are 1 034, 506 and 695 bytes (578, 353 and 430
gzip). The Nuxt module grows by 1 531 bytes; it runs at build time.

## Alternatives

- **A `.svelte` component.** It would import `$app/navigation` itself and leave one line, but only
  a package with a `svelte` export condition is compiled by the app. vite-plugin-svelte (7.3) then
  classifies the whole package as a Svelte library and removes it from `optimizeDeps` in
  development; the `svelte` peer already puts it in `ssr.noExternal`. That changes how every other
  import of this package is served to every SvelteKit project, for a saving of two lines.
- **Props instead of the `next` import.** `LivePreviewRouteRefresh` takes `refresh` as a prop for
  this reason. Passing three hooks in would leave most of the glue in the project.
- **Generate the whole Nuxt plugin as a string.** The logic would then be tested only as text; as
  a module it has unit tests, coverage and an API report.
- **Put the functions in `./react`, `./sveltekit` and `./nuxt`.** `./react` serves React projects
  that have no `next`. The other two are server adapters that a client bundle should not reach.

## Consequences

- Three API reports and three bundle budgets. The package smoke loads `./sveltekit/client` and
  `./nuxt/client` with their peers. It loads `./nextjs/client` with `next/navigation` served by its
  loader, because only a Next build resolves that module for the package. The post-publish smoke
  skips that entry.
- The examples use the entries, so the navigation suites in three browsers on Next.js 16, SvelteKit
  2 and 3 and Nuxt 3 and 4 test the shipped code instead of a copy of it.
- The event name and `registerRouteRefresh()` stay public for routers this package does not
  adapt.
