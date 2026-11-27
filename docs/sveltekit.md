# SvelteKit

SvelteKit 3 with server-side rendering. The `handle` hook decides before the page renders, publishes its decision on `event.locals`, injects the runtime into the `<head>` of authorized preview responses and merges the CSP.

CI runs the example on SvelteKit 3.1.1 on every push, against the mock admin and from the real admin in Chromium, Firefox and WebKit. It also drives the example's production build from the real admin, and the `production-lifecycle` job builds a SvelteKit host from the stored package archive.

SvelteKit 2 is no longer tested. Its release line carries a high-severity advisory that is patched only in SvelteKit 3.1.1 ([GHSA-3r8g-jcqq-3p5j](https://github.com/advisories/GHSA-3r8g-jcqq-3p5j)), so no job installs it any more. The adapter did not change with that, and a SvelteKit 2 project keeps the code it has; nothing proves it on a push. The snippets below are written for SvelteKit 3. A SvelteKit 2 project writes `$lib` for `#lib`, `$app/environment` for `$app/env` and the `$env/...` modules for `$app/env/private`, imports `Handle` from `@sveltejs/kit`, and sets the adapter in `svelte.config.js` instead of `sveltekit()` in `vite.config.ts` ([migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)).

Environment names used below: `PAYLOAD_ADMIN_ORIGIN` is the admin origin the browser sees, `PAYLOAD_URL` the Payload origin server code talks to. Server code reads both from `$app/env/private` once `src/env.ts` declares them; `process.env` does not type-check in a fresh project without `@types/node`.

```ts
// src/env.ts
import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  // A missing variable arrives as the empty string.
  PAYLOAD_ADMIN_ORIGIN: { schema: (input) => input ?? '' },
  PAYLOAD_URL: { schema: (input) => input ?? '' },
});
```

## Install

```bash
npm install payload-live-preview
```

## The handle

There is no separate setup step. SvelteKit already has one place where a request passes through server code, and `livePreviewHandle` is a handle like any other — the export below is the whole integration: injection, CSP and authorization.

```ts
// src/hooks.server.ts
import { PAYLOAD_ADMIN_ORIGIN, PAYLOAD_URL } from '$app/env/private';
import { livePreviewHandle } from 'payload-live-preview/sveltekit';
import { authorizePreviewRequest } from 'payload-live-preview/server';

export const handle = livePreviewHandle({
  allowedOrigins: [PAYLOAD_ADMIN_ORIGIN],
  // Payload 3.x: re-fetch the populated document; mergeDepth is required with serverURL.
  serverURL: PAYLOAD_ADMIN_ORIGIN,
  mergeDepth: 1,
  // Required: without the hook the handle refuses to
  // start, and every route fails, not only the preview.
  authorizePreview: (request) =>
    authorizePreviewRequest(request, { type: 'payload-session', serverURL: PAYLOAD_URL }),
});
```

Compose it with `sequence()` next to other hooks; it never short-circuits the chain. `authorizePreview` runs on requests carrying preview intent (the query parameter `preview`, `draft` or `livePreview` set to `true` or `1`); a refusal leaves the response exactly as rendered. The handle also requires `https:` admin origins in production and no referer trust. The three strategies and what each one binds: [authorization.md](authorization.md).

## The runtime as a cached asset

The handle inlines the runtime by default. `delivery: 'asset'` puts a bootstrap of a few hundred bytes there instead, which fetches the runtime only once the page finds itself in a preview context:

```ts
// src/routes/payload-live-preview/[file]/+server.ts
import { createRuntimeAssetRoute } from 'payload-live-preview/sveltekit';
import { livePreviewOptions } from '#lib/live-preview.js';

export const { GET } = createRuntimeAssetRoute(livePreviewOptions);
```

Give `livePreviewHandle` the same object with `delivery: 'asset'` on it. The dynamic segment carries the content hash, and the handler answers that one name — a request for any other 404s rather than returning current bytes under an old name, which is what lets the response say `Cache-Control: public, max-age=31536000, immutable`.

A handle sees the request, so the choice can be per route. The example splits on the pathname: `/asset` gets the bootstrap, everything else the inlined runtime, from two handles that differ in that one option. Authorization is untouched either way — an unauthorized request gets neither.

Move the route folder and set `assetPath` together if the app is not served from the site root. What a proxy must not do to the file, and why: [deployment.md](deployment.md#the-runtime-as-a-cached-asset).

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
import { PAYLOAD_URL } from '$app/env/private';
import { createPreviewBindings, definePreview } from 'payload-live-preview/server';
import type { PageServerLoad } from './$types';

// depth is written once for the initial read and the runtime merge.
const preview = definePreview({ serverURL: PAYLOAD_URL, depth: 1 });

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

### Rich text on the server

`lexicalToHtml()` sanitizes with a DOM, and `load` runs where there is none. Hand it a document for each render, from jsdom (your own dependency), in a module under `src/lib/server` so it never reaches the browser bundle. A render without one throws instead of returning a custom node's markup unsanitized; `requireDocument: true` in the call below says what 3.0 does by default:

```ts
// src/lib/server/rich-text.ts
import { JSDOM } from 'jsdom';
import { lexicalToHtml, type LexicalRoot } from 'payload-live-preview/lexical';

export function richText(value: LexicalRoot | null | undefined): string {
  if (!value) return '';
  // A document for this render alone: two requests in flight never share one.
  const { document } = new JSDOM('<!doctype html><html><body></body></html>').window;
  return lexicalToHtml(value, { document, requireDocument: true });
}
```

`load` above then returns `body: richText(result.data.body)` and a binding for it, `bindings.bind<PageDocument>('body', { richtext: true })`, and the template writes the HTML into the bound element:

```svelte
<div {...data.bindings.body}>{@html data.body}</div>
```

The element is there while the field is empty too, so the first edit has somewhere to land. `richtext: true` writes `data-payload-richtext`, which forces Lexical rendering and has every edit ask Payload to fill in the value's nodes ([bindings.md](bindings.md)).

## Client navigation and route refreshes

The handle arms preview responses for the package's navigation event; the
browser half is `livePreviewNavigation()` from
`payload-live-preview/sveltekit/client` (since 2.4). Call it once from a layout
that remains present across the preview routes, with SvelteKit's own two
functions:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { afterNavigate, invalidateAll } from '$app/navigation';
  import { livePreviewNavigation } from 'payload-live-preview/sveltekit/client';

  livePreviewNavigation({ afterNavigate, invalidateAll });
</script>
```

It must run while the component initialises, as `afterNavigate` must. The
functions are passed in because `$app/navigation` exists only inside a Kit
build: a package that imported it would have to be compiled by the app as a
Svelte library, which changes how Vite treats every other import of the package.

After a committed client navigation the runtime rebuilds its bindings and
locally reapplies the last accepted editor document, so this does not depend on
the editor answering another `ready`. `afterNavigate` runs once on the initial
mount with `from: null`, and a shallow `goto` (SvelteKit 3) keeps the rendered
route; neither counts as a navigation. For an unbound or conditional field the
route strategy uses `invalidateAll()`, which settles the route's server and
universal loads, then `tick()`, which settles the DOM, and only then does the
runtime reapply the unsaved document. When the layout unmounts, the refresh is
released.

Before 2.4 this guide had the project copy a 16-line bridge for the same job.
It keeps working; replace it with the call above.

The adapter authorizes SvelteKit's internal data requests against `event.url`,
the normalized page URL rather than its `__data.json` transport path. Keep a
query-carried preview credential in navigation links; a session cookie needs no
special URL handling.

## Server-rendered boundaries

A patch reaches what the markup annotates. It cannot create a section the
template renders only when a field is set, and it cannot run a component's own
logic. For those, mark the region as a fragment boundary and let the server
render it from the unsaved form state:

```ts
// src/routes/payload/fragment/+server.ts
import { createFragmentEndpoint } from 'payload-live-preview/sveltekit';
import Hero from '#lib/Hero.svelte';
import { heroProps } from '#lib/hero.js';
import { authorizePreview } from '#lib/authorize-preview.js';

export const POST = createFragmentEndpoint({
  authorizePreview,
  registry: { hero: { component: Hero, props: ({ fields }) => heroProps(fields) } },
});
```

Point the script at it — `fragments: { endpoint: '/payload/fragment' }` in the
handle's options — and mark the region with a boundary from the same
`createPreviewBindings()` object `load` uses above: return
`boundary: bindings.boundary('hero', { dependsOn: ['title', 'subtitle'] })` and
spread it as `<section {...data.boundary}>`. It is gated on the same verdict as
`bindings.bind()`.

Pass the complete SvelteKit event if you wrap `POST`. On adapter-node HTTP/1,
the binding uses `event.platform.req` to detect a disconnect after upload.
An unfinished body is paused and its refusal response is flushed before the
connection closes; a fully read body keeps normal connection reuse. Other
adapters continue to use the Web request's own cancellation signal.

Svelte renders through `render()` from `svelte/server`, and the endpoint
delivers its `body`: `<svelte:head>` output belongs to the document head, which
the route strategy owns. `svelte` is an optional peer, imported at the first
render.

A component the endpoint renders has to be part of the page, so SvelteKit
links its scoped CSS before the first unsaved value needs it: import it in the
route's `+page.svelte` and render it, empty if need be, inside its boundary. A
component only the endpoint imports arrives without its styles. `props` also
receives `locals`, the `event.locals` your hooks set on the fragment request,
as `load` reads them on the page request; narrow it with
`locals as App.Locals`
([ADR 0029](architecture/0029-fragment-components-and-locals-belong-to-the-page.md)).

A page built around boundaries usually wants `export const csr = false` on that
route: the runtime writes into the DOM, and a component hydrating afterwards can
reset what was patched (the caveat below). Registry, limits, the fallback and
the abuse model: [hybrid.md](hybrid.md).

## Caveats

- **Hydration and the first write.** Svelte's hydration sets a text the runtime wrote before it back to its own value, quietly. So every script the handle emits declares `hydration: 'sveltekit'`, and under it the runtime does not start (no `ready`, no listener) until SvelteKit's root has mounted; the admin's first document then lands on markup Svelte is done with. A route served with `csr = false` has no client and starts at once. A page whose client never mounts starts after five seconds and reports `LP0607`; `inspect().hydration` reads `{ mode: 'sveltekit', state }`. How the runtime sees the mount, and what can go wrong: [ADR 0015, addendum](architecture/0015-first-write-after-hydration.md#addendum-2026-10-01--sveltekit).
- **Hydration.** A component that re-renders a bound element from its own state overwrites the live patch. Bind fields in server-rendered markup, and mark a client-owned root with `data-payload-island` so the runtime never patches or morphs into it ([renderers.md](renderers.md)).
- **Array templates.** Svelte reads `{…}` in an attribute as an expression, so an inline `{{title}}` is not the template text: it renders an object, or fails on a `title` that is not declared. Bind the template as a string:

```svelte
<script lang="ts">
  const template = '<li><a href="{{url}}">{{title}}</a></li>';
</script>

<ul data-payload-field="posts" data-payload-array data-payload-array-template={template}></ul>
```

## A client-rendered component

The runtime patches what SvelteKit rendered on the server. A component that renders from a document itself, the way React's `useLivePreviewDocument()` does, can use `createDocumentSession()` from `payload-live-preview/core`, which needs no framework. The session's `subscribe` and `getSnapshot` fit a Svelte store:

```ts
import { readable } from 'svelte/store';
import { createDocumentSession, type DocumentSessionOptions } from 'payload-live-preview/core';

export function livePreviewDocument<T>(initialData: T, options: DocumentSessionOptions) {
  const session = createDocumentSession(initialData, options);
  return readable(session.getSnapshot(), (set) =>
    session.subscribe(() => {
      set(session.getSnapshot());
    }),
  );
}
```

Then `$doc.data`, `$doc.status` and `$doc.error` read as in the React hook, and the last subscriber leaving ends the session. `createDocumentSession()` is `@beta`. This recipe is held by a unit test on `svelte/store`, not by a browser test in a Svelte component.

## Point the Payload admin at this site

The admin has to know which URL to show for each document. In the Payload project's `payload.config.ts`, the config plugin from `payload-live-preview/plugin` maps collections and globals to paths on this site and enables Live Preview for them. If Payload is a separate project, install `payload-live-preview` there too.

```ts
// payload.config.ts
import { livePreview } from 'payload-live-preview/plugin';

export default buildConfig({
  // collections, db, editor …
  plugins: [
    livePreview({
      baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
      collections: { posts: ({ data }) => `/blog/${String(data['slug'] ?? '')}` },
      globals: { homepage: '/' },
    }),
  ],
});
```

The callback appends `?preview=true`, a preview intent that authorizes nothing. Breakpoints, merge rules and conflicts are in [payload.md](payload.md). A document without a route that should show no preview, another plugin that already sets the Live Preview URL, or a signed token in the URL need the lower-level `buildLivePreviewUrl()` from `payload-live-preview/payload` instead ([payload.md](payload.md), [authorization.md](authorization.md#signed-token)).

## Example

[`examples/sveltekit-payload`](../examples/sveltekit-payload) — `livePreviewHandle()` with the `signed-token` strategy and owner-scoped bindings on SvelteKit 3, and `/hybrid` with its endpoint at `src/routes/payload/fragment/+server.ts`. Run in Chromium, Firefox and WebKit.

## When something does not update

`__livePreview.inspect()` in the preview iframe's console names the cause in most cases; the readings, `pll doctor` and every diagnostic code are in [troubleshooting.md](troubleshooting.md). The doctor's preview request carries `?preview=true`; behind `authorizePreview` it needs an editor's credentials: a Payload session as `--header "Cookie: payload-token=$PAYLOAD_TOKEN"`, a signed token in the URL as `?previewToken=$PREVIEW_TOKEN` (the visitor request drops it), or `--header "x-preview-token: $PREVIEW_TOKEN"` only where the strategy sets `transport: { kind: 'header' }`. Headers go with the preview request only and their values are never printed; a token in the URL is printed as `previewToken=…`. Keep the credential in an environment variable and run the doctor as `node_modules/.bin/pll`, not through `npx`, which prints the whole command line ([troubleshooting.md](troubleshooting.md#auditing-a-deployment-pll-doctor)).
