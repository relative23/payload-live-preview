---
'payload-live-preview': minor
---

Add `payload-live-preview/vue`: the same merged document as a composable.

```vue
<script setup lang="ts">
import { useLivePreviewDocument } from 'payload-live-preview/vue';

const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
  serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_URL],
  initialData: props.page,
  depth: 1,
});
</script>
```

It is the React hook's session with Vue's reactivity on top — the four returned
values are refs — so the five differences from `@payloadcms/live-preview` hold
here too: a trailing slash on `serverURL` still merges, a slow response never
overwrites a newer one, a failed request keeps the last good document, an HTTP
error body never becomes the document, and two composables on one page have two
caches.

Call it from `setup()` or inside an `effectScope()`. The subscription is released
with that scope; a call without one throws instead of leaking a window listener
and a request in flight for the life of the page.

`vue` is an optional peer, imported by this entry alone. With the SvelteKit and
Nuxt fragment endpoints and the React hook, the package now covers both official
live-preview packages and every framework it adapts.
