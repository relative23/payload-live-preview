# Nuxt

Nuxt 3 with server-side rendering. A Nitro plugin injects the runtime into authorized preview responses and merges the CSP; a server handler decides before the Vue app renders, so pages can read the decision from `event.context`.

Environment names used below: `PUBLIC_PAYLOAD_ADMIN_ORIGIN` is the admin origin the browser sees, `PAYLOAD_URL` the Payload origin server code talks to.

## Install

```bash
npm install payload-live-preview
```

## One options object

The plugin and the handler share their options, so write them once:

```ts
// server/utils/live-preview.ts
import { authorizePreviewRequest } from 'payload-live-preview/server';
import type { LivePreviewNuxtOptions } from 'payload-live-preview/nuxt';

export const livePreviewOptions: LivePreviewNuxtOptions = {
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
  // Payload 3.x: re-fetch the populated document; mergeDepth is required with serverURL.
  serverURL: process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!,
  mergeDepth: 1,
  // Required under the strict default: without the hook the plugin refuses to start.
  authorizePreview: (request) =>
    authorizePreviewRequest(request, {
      type: 'payload-session',
      serverURL: process.env.PAYLOAD_URL!,
    }),
};
```

The strict default also requires `https:` admin origins in production and no referer trust. The three strategies — `payload-session`, `signed-token`, `verifier` — and what each one binds: [authorization.md](authorization.md).

## The Nitro plugin

```ts
// server/plugins/live-preview.ts
import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';
import { livePreviewOptions } from '../utils/live-preview';

export default defineNitroPlugin(livePreviewNitroPlugin(livePreviewOptions));
```

It hooks `render:html`. On a request carrying preview intent (the query parameter `preview`, `draft` or `livePreview` set to `true`) it runs `authorizePreview`, and only an authorized decision injects the script, merges the CSP header and marks the response `private, no-store`. With `autoInject: false` it injects nothing; `renderLivePreviewScript()` and `buildLivePreviewCsp()` from `payload-live-preview/nuxt` then produce the tag and the header value for a `render:html` hook of your own, gated on the same decision.

## The server handler

`render:html` runs after the Vue app rendered. A page that needs the decision for its own draft read registers the handler as server middleware with the same options: it decides before the app renders and publishes on `event.context`, and the plugin reuses that decision instead of authorizing twice.

```ts
// server/middleware/live-preview.ts
import { defineLivePreviewServerHandler } from 'payload-live-preview/nuxt';
import { livePreviewOptions } from '../utils/live-preview';

export default defineEventHandler(defineLivePreviewServerHandler(livePreviewOptions));
```

## Read `event.context`

The keys are the ones the Astro and SvelteKit adapters publish, typed once through `LivePreviewLocals`: `livePreviewAuthorization` (the verified context, only when the hook authorized), `livePreviewAuthorizationOutcome` (`'authorized'` or the refusal reason, whenever the hook ran) and `livePreviewNonce` (the CSP nonce for scripts of your own; withheld after a refusal).

```ts
// types/live-preview.d.ts
import type { LivePreviewLocals } from 'payload-live-preview/nuxt';

declare module 'h3' {
  interface H3EventContext extends LivePreviewLocals {}
}
```

In a page the event exists on the server only. `useState` runs the read there and hands the result to the client, so hydration sees the attributes the server rendered. The binding helpers come from the root entry, because a page also runs in the browser and they only emit attributes:

```vue
<script setup lang="ts">
import { createPreviewBindings } from 'payload-live-preview';

const bindings = useState('preview-bindings', () => {
  const event = useRequestEvent(); // undefined in the browser
  const preview = createPreviewBindings({
    authorization: event?.context.livePreviewAuthorization ?? null,
    owner: 'collection:pages',
  });
  return { owner: preview.owner(), title: preview.bind('title') };
});
</script>

<template>
  <h1 v-bind="{ ...bindings.owner, ...bindings.title }">{{ page.title }}</h1>
</template>
```

On a public response the helpers return empty objects, and the markup carries no `data-payload-*` attribute at all. The initial draft read is server code — `definePreview()` from `payload-live-preview/server` — and a Nitro route that serves the page's data is its own request, so it authorizes that request with the same strategy; [authorization.md](authorization.md) has the read.

## Server-rendered boundaries

A patch reaches what the markup annotates. It cannot create a section the
template renders only when a field is set, and it cannot run a component's own
logic. For those, mark the region as a fragment boundary and let the server
render it from the unsaved form state:

```ts
// server/routes/payload/fragment.post.ts
import { createFragmentEndpoint } from 'payload-live-preview/nuxt';
import Hero from '../../../components/Hero.vue';
import { heroProps } from '../../../lib/hero';

const endpoint = createFragmentEndpoint({
  authorize: { type: 'signed-token', secret: TOKEN_SECRET, audience: SITE_ORIGIN },
  registry: { hero: { component: Hero, props: ({ fields }) => heroProps(fields) } },
});

export default defineEventHandler((event) => endpoint(toWebRequest(event)));
```

The binding takes a `Request`, which is what `toWebRequest()` makes of the H3
event; this package therefore needs no `h3` dependency to describe its own
signature. Point the script at the route — `fragments: { endpoint:
'/payload/fragment' }` in the plugin's options — and mark the region with
`data-payload-fragment="hero"`.

Vue renders through `renderToString()` from `vue/server-renderer`, one SSR app
per render. `vue` is an optional peer imported at the first render.

The component is rendered inside the Nitro bundle, and Nitro's rollup does not
know single-file components. Add the plugin once:

```ts
// nuxt.config.ts
import vue from '@vitejs/plugin-vue';
export default defineNuxtConfig({ nitro: { rollupConfig: { plugins: [vue()] } } });
```

Without it the server build fails on the first `.vue` import from `server/`. The
alternative is a `defineComponent` in a `.ts` file, which Nitro reads as it is.
Registry, limits, the fallback and the abuse model: [hybrid.md](hybrid.md).

## Caveats

- **Hydrated components.** The runtime patches the server-rendered markup. A Vue component that re-renders a bound node overwrites the patch: bind fields in server-rendered regions, mark a client-owned root with `data-payload-island` ([renderers.md](renderers.md)), or use the official `@payloadcms/live-preview-vue` composable inside client components.
- **Hydration and boundaries.** The same applies to a fragment boundary, with one extra wrinkle: hydration resets what Vue owns, so a boundary the server re-rendered _before_ the page finished hydrating is thrown away — the runtime rendered it, `inspect().fragments.rendered` counts it, and the markup is gone. Once hydrated, Vue is idle and a morph survives. Put boundaries in markup Vue does not own (a server component, or a region marked `data-payload-island` for the runtime to own alone) if an update can arrive that early.
- **Array templates.** Vue reads `{{ … }}` as its own interpolation, so an inline template is silently empty. Bind it as a string:

```vue
<script setup lang="ts">
const template = '<li><a data-payload-href="url">{{title}}</a></li>';
</script>

<template>
  <ul data-payload-field="posts" :data-payload-array-template="template"></ul>
</template>
```

## Example

[`examples/nuxt-payload`](../examples/nuxt-payload) — `livePreviewNitroPlugin()` on Nuxt 3, and `/hybrid` with its endpoint at `server/routes/payload/fragment.post.ts`. Run in Chromium, Firefox and WebKit.

## When something does not update

`__livePreview.inspect()` in the preview iframe's console names the cause in most cases; the readings, `pll doctor` and every diagnostic code are in [troubleshooting.md](troubleshooting.md).
