# Vue composable

`useLivePreviewDocument()` subscribes to the admin's updates and returns the
merged document as refs, so your components re-render with it. Same shape as
Payload's own `useLivePreview`, with this package's merge underneath — and the
same session as the [React hook](react.md); only the reactivity differs.
Payload 2 uses the accepted field schema and credentialed collection GETs
for raw relationships; Payload 3 uses its method-override merge POST.
The [transport details](react.md#five-where-the-results-differ) apply to both.

> This is the other half of the package, not a replacement for it. The DOM
> runtime patches server-rendered markup; the composable gives Vue reactive data
> for the client-owned tree. A stable component identity preserves component
> and DOM state. A changed type, key or position can cause a remount or
> replacement; the replaced node loses its state. The ownership choice is in
> [react.md](react.md#the-caveat-that-decides-which-one-you-want).

## Install

```bash
npm install payload-live-preview
```

`vue` is an optional peer this package does not install. The `./vue` entry and
the Nuxt fragment renderer are the only places that need it.

## The composable

```vue
<script setup lang="ts">
import { useLivePreviewDocument } from 'payload-live-preview/vue';

const props = defineProps<{ page: Page }>();

const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
  serverURL: import.meta.env.VITE_PAYLOAD_URL,
  allowedOrigins: [import.meta.env.VITE_PAYLOAD_ADMIN_ORIGIN],
  initialData: props.page,
  depth: 1,
});
</script>

<template>
  <article>
    <h1>{{ data.title }}</h1>
    <p v-if="data.subtitle" class="lede">{{ data.subtitle }}</p>
    <p v-if="status === 'unavailable'" role="status">Preview paused: {{ error?.message }}</p>
  </article>
</template>
```

This example uses Vite's default `VITE_` public prefix. Both values are public
browser-visible origins, not credentials; keep tokens and secrets in server-only
variables. A host that changes Vite's `envPrefix` can use its configured public
name instead.

Every option is the one the React hook takes, with the same defaults
([react.md](react.md#the-hook) has the table): `serverURL` and `initialData` are
required, `depth` is `1`, `apiRoute` is `/api`, `allowedOrigins` names the admin
origins, and a message is accepted only from the window that framed or opened
the page unless `eventSourcePolicy: 'any'` says otherwise.

The five returned values are refs: `data`, `isLoading`, `status`
(`'idle' | 'live' | 'unavailable'`), `error` and `revision`. `data` and
`isLoading` are Payload's two names. `isLoading` is `true` until an update
settles, turns `true` again with every update it accepts, and is `false` once the
newest one has merged or failed to. `revision` says which of the composable's
messages `data` came from: `0` for `initialData`, unchanged when a merge fails.
`status` describes the merge; Vue patches the DOM afterwards, so a watcher with
`flush: 'post'` on `revision` runs once the editor can see it.

`data` is the document as Payload's REST API returned it. A media document's `url`
is a path on Payload's own origin (`/api/media/file/a.png`) unless its config sets
`serverURL`, so a page on another origin resolves it first:
`new URL(data.value.image.url, serverURL)`. The DOM runtime does this for its
`upload` and `image` bindings ([Media URLs](renderers.md#media-urls)); the
composable leaves it to your component.

## Scope

Call it from `setup()`, or inside an `effectScope()`. The subscription — a window
listener and any request in flight — is released when that scope is disposed, and
a call without one throws rather than leaking both for the life of the page.

The options belong to that scope; they are not reactive inputs. If a route reuses
the component for another CMS document, key and remount the preview component by
document owner and id. Disposal cancels the old session, and the new setup call
starts from its own `initialData`. On Payload 2 that session starts without a
field schema, and Payload 2.32.3 sends the schema only with its first message
to the preview: the next update reports `'unavailable'` and reads nothing until
the admin page is loaded again
([interop.md](interop.md#what-is-shared-exactly)). A read the old scope started
can still answer after that, for example when a custom `fetchFn` (an option
meant for tests) ignores the abort signal. The answer changes nothing: the new
session keeps what it has and starts no read for it.

The real-admin runs of the composable (Payload 2.32.3 and 3.90.2) use
development bundles; a production build is server-rendered, hydrated and taken
through its lifecycle against the mock admin
(`tests/e2e/specs/react-vue-tarball.spec.ts`).

## Measured against the official package

The same five cases as the React hook use the shared framework-independent
session and have the same results. They do not mount a Vue component or install
the packed `./vue` entry. The table, exact version and test boundary are in
[react.md](react.md#measured-against-the-official-package).

## With Nuxt

A Nuxt page can use this composable directly, and the fragment endpoint from
[nuxt.md](nuxt.md) beside it: the composable owns the client-rendered subtree,
the runtime owns the server-rendered markup around it. Mark the composable's root
`data-payload-island` so the runtime never patches into what Vue re-renders
([interop.md](interop.md)).
