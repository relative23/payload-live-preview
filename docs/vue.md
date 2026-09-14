# Vue composable

`useLivePreviewDocument()` subscribes to the admin's updates and returns the
merged document as refs, so your components re-render with it. Same shape as
Payload's own `useLivePreview`, with this package's merge underneath — and the
same session as the [React hook](react.md); only the reactivity differs.

> This is the other half of the package, not a replacement for it. The DOM
> runtime patches server-rendered markup and keeps the visitor's state; a
> composable re-renders the tree and loses it. The trade is in
> [react.md](react.md#the-caveat-that-decides-which-one-you-want), and it is the
> same one here.

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
  serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_URL],
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

Every option is the one the React hook takes, with the same defaults
([react.md](react.md#the-hook) has the table): `serverURL` and `initialData` are
required, `depth` is `1`, `apiRoute` is `/api`, `allowedOrigins` names the admin
origins, and a message is accepted only from the window that framed or opened
the page unless `eventSourcePolicy: 'any'` says otherwise.

The four returned values are refs: `data`, `isLoading`, `status`
(`'idle' | 'live' | 'unavailable'`) and `error`. `data` and `isLoading` are
Payload's two names. `isLoading` is `true` until an update settles, turns `true`
again with every update it accepts, and is `false` once the newest one has merged
or failed to.

## Scope

Call it from `setup()`, or inside an `effectScope()`. The subscription — a window
listener and any request in flight — is released when that scope is disposed, and
a call without one throws rather than leaking both for the life of the page.

## Measured against the official package

The same seven cases as the React hook, from the same session and with the same
results — five where the two packages differ and two where they do not. The
table, and what each case was measured with, is in
[react.md](react.md#measured-against-the-official-package).

## With Nuxt

A Nuxt page can use this composable directly, and the fragment endpoint from
[nuxt.md](nuxt.md) beside it: the composable owns the client-rendered subtree,
the runtime owns the server-rendered markup around it. Mark the composable's root
`data-payload-island` so the runtime never patches into what Vue re-renders
([interop.md](interop.md)).
