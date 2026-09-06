# SvelteKit

SvelteKit 2 with server-side rendering. The `handle` hook decides before the page renders, publishes its decision on `event.locals`, injects the runtime into the `<head>` of authorized preview responses and merges the CSP.

Environment names used below: `PUBLIC_PAYLOAD_ADMIN_ORIGIN` is the admin origin the browser sees, `PAYLOAD_URL` the Payload origin server code talks to. SvelteKit exposes `PUBLIC_`-prefixed variables through `$env/dynamic/public` and the rest through `$env/dynamic/private`; `process.env` does not type-check in a fresh project without `@types/node`.

## Install

```bash
npm install payload-live-preview
```

## The handle

```ts
// src/hooks.server.ts
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { livePreviewHandle } from 'payload-live-preview/sveltekit';
import { authorizePreviewRequest } from 'payload-live-preview/server';

const adminOrigin = publicEnv.PUBLIC_PAYLOAD_ADMIN_ORIGIN ?? '';

export const handle = livePreviewHandle({
  allowedOrigins: [adminOrigin],
  // Payload 3.x: re-fetch the populated document; mergeDepth is required with serverURL.
  serverURL: adminOrigin,
  mergeDepth: 1,
  // Required under the strict default: without the hook the handle refuses to
  // start, and every route fails, not only the preview.
  authorizePreview: (request) =>
    authorizePreviewRequest(request, { type: 'payload-session', serverURL: env.PAYLOAD_URL ?? '' }),
});
```

Compose it with `sequence()` next to other hooks; it never short-circuits the chain. `authorizePreview` runs on requests carrying preview intent (the query parameter `preview`, `draft` or `livePreview` set to `true`); a refusal leaves the response exactly as rendered. The strict default also requires `https:` admin origins in production and no referer trust. The three strategies and what each one binds: [authorization.md](authorization.md).

## Types for `event.locals`

```ts
// src/app.d.ts
import type { LivePreviewLocals } from 'payload-live-preview/sveltekit';

declare global {
  namespace App {
    interface Locals extends LivePreviewLocals {}
  }
}

export {};
```

Three optional keys: `livePreviewAuthorization` (the verified context, only when the hook authorized), `livePreviewAuthorizationOutcome` (`'authorized'` or the refusal reason, whenever the hook ran) and `livePreviewNonce` (the CSP nonce for scripts of your own; withheld after a refusal).

## Read the decision in `load`

```ts
// src/routes/[slug]/+page.server.ts
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createPreviewBindings, definePreview } from 'payload-live-preview/server';
import type { PageServerLoad } from './$types';

// depth is written once for the initial read and the runtime merge.
const preview = definePreview({ serverURL: env.PAYLOAD_URL ?? '', depth: 1 });

export const load: PageServerLoad = async ({ locals, params, request }) => {
  const authorization = locals.livePreviewAuthorization ?? null;
  const result = await preview.fetchDocument<PageDocument>({
    collection: 'pages',
    where: { slug: { equals: params.slug } },
    authorization, // a verified context reads the draft, null the published document
    signal: request.signal,
  });
  if (!result.ok || result.data === null) error(404);
  const bindings = createPreviewBindings({
    authorization,
    owner: `collection:pages:${result.data.id}`,
  });
  return {
    page: result.data,
    bindings: { owner: bindings.owner(), title: bindings.bind<PageDocument>('title') },
  };
};
```

`PageDocument` is your document type. The binding helpers return plain attribute objects, so they serialize through `load` and spread into the template; on a public response they are empty, and the markup carries no `data-payload-*` attribute at all:

```svelte
<script lang="ts">
  let { data } = $props();
</script>

<section {...data.bindings.owner}>
  <h1 {...data.bindings.title}>{data.page.title}</h1>
</section>
```

## Server-rendered boundaries

A patch reaches what the markup annotates. It cannot create a section the
template renders only when a field is set, and it cannot run a component's own
logic. For those, mark the region as a fragment boundary and let the server
render it from the unsaved form state:

```ts
// src/routes/payload/fragment/+server.ts
import { createFragmentEndpoint } from 'payload-live-preview/sveltekit';
import Hero from '$lib/Hero.svelte';
import { heroProps } from '$lib/hero';
import { authorizePreview } from '$lib/authorize-preview';

export const POST = createFragmentEndpoint({
  authorizePreview,
  registry: { hero: { component: Hero, props: ({ fields }) => heroProps(fields) } },
});
```

Point the script at it — `fragments: { endpoint: '/payload/fragment' }` in the
handle's options — and mark the region with
`{...preview.boundary('hero', { dependsOn: ['title', 'subtitle'] })}`, which is
gated on the same verdict as `preview.bind()`.

Svelte renders through `render()` from `svelte/server`, and the endpoint
delivers its `body`: `<svelte:head>` output belongs to the document head, which
the route strategy owns. `svelte` is an optional peer, imported at the first
render.

A page built around boundaries usually wants `export const csr = false` on that
route: the runtime writes into the DOM, and a component hydrating afterwards can
reset what was patched (the caveat below). Registry, limits, the fallback and
the abuse model: [hybrid.md](hybrid.md).

## Caveats

- **Hydration.** A component that re-renders a bound element from its own state overwrites the live patch. Bind fields in server-rendered markup, and mark a client-owned root with `data-payload-island` so the runtime never patches or morphs into it ([renderers.md](renderers.md)).
- **Array templates.** Svelte reads `{…}` in an attribute as its own interpolation, so an inline `{{title}}` is a compile error. Bind the template as a string:

```svelte
<script lang="ts">
  const template = '<li><a data-payload-href="url">{{title}}</a></li>';
</script>

<ul data-payload-field="posts" data-payload-array-template={template}></ul>
```

## Example

[`examples/sveltekit-payload`](../examples/sveltekit-payload) — `livePreviewHandle()` with the `signed-token` strategy and owner-scoped bindings on SvelteKit 2, and `/hybrid` with its endpoint at `src/routes/payload/fragment/+server.ts`. Run in Chromium, Firefox and WebKit.

## When something does not update

`__livePreview.inspect()` in the preview iframe's console names the cause in most cases; the readings, `pll doctor` and every diagnostic code are in [troubleshooting.md](troubleshooting.md).
