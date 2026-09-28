# Hybrid preview: patch, fragment, route

Patching (the default) edits the elements a page already renders. Two
things it cannot do: create markup that a template renders only when a
field is set, and run a component's own logic (derived values, custom
blocks, conditional sections). The **fragment** strategy asks your server
to render one component boundary from the unsaved form state and morphs
the result in. Compatible, paired live nodes are retained, so their focus and
live properties survive. An incompatible or unpaired node is replaced and its
state is lost. The exact pairing and ownership rules are in
[ADR 0008 — Keyed morph: what it keeps, what it never crosses](architecture/0008-keyed-morph-ownership.md).
The **route** strategy refreshes the whole route when nothing smaller is
safe. The protocol and its abuse model are recorded in
[ADR 0011 — The fragment protocol and its abuse model](architecture/0011-fragment-protocol-and-abuse-model.md).

A boundary is also the least markup this package can be used with: one
attribute per component instead of one per field, with the fidelity of a full
render inside it. That trade — and when field bindings are still the better
answer — is
[bindings.md](bindings.md#how-much-markup-this-actually-needs).

## Marking a boundary

```astro
<section data-payload-fragment="hero" data-payload-depends="title,tagline,body">
  <h1 data-payload-field="title">{title}</h1>
  {tagline && <p class="lede">{tagline}</p>}
  <p>{wordCount(body)} words</p>
</section>
```

- `data-payload-fragment="hero"` — a **registry id** (`[a-z][a-z0-9-]*`).
  Never a path or a module name: the server decides what `hero` renders.
  `createPreviewBindings().boundary('hero', { dependsOn: [...] })` writes these
  three attributes from the request's authorization, so an unauthorized response
  carries no boundary either ([bindings.md](bindings.md#keeping-binding-attributes-off-public-responses)).
- `data-payload-depends` — the fields that re-render the boundary. Without
  it, every update does.
- `data-payload-fragment-key` — when one id renders several boundaries on a
  page (one per list item, say).
- Bindings inside the boundary still work as the **fallback**: if the
  server cannot render (network, timeout, refusal, bad response), the
  runtime patches them from the same revision and reports an `LP08xx`
  code. The editor never sees stale content presented as current.

A boundary inside an island (`<astro-island>`, `data-payload-island`) is the
island's business and is never rendered by the server.

## The endpoint

One endpoint, one binding per component system. What differs is the import, the
shape the framework hands a route handler, and which renderer is loaded; the
protocol, the authorization, the limits and the registry lookup are the same
code underneath all four.

| Framework     | Import                           | Route file                                            | Renders with          |
| ------------- | -------------------------------- | ----------------------------------------------------- | --------------------- |
| Astro         | `payload-live-preview/astro`     | `src/pages/payload/fragment.ts` (`prerender = false`) | `astro/container`     |
| Next.js       | `payload-live-preview/nextjs`    | `app/payload/fragment/route.ts`                       | `react-dom/server`    |
| SvelteKit     | `payload-live-preview/sveltekit` | `src/routes/payload/fragment/+server.ts`              | `svelte/server`       |
| Nuxt          | `payload-live-preview/nuxt`      | `server/routes/payload/fragment.post.ts`              | `vue/server-renderer` |
| Anything else | any of them, plus `render`       | that framework's POST route                           | your function         |

### Astro

The endpoint authorizes with the same hook as the page. Define it once and
hand it to both:

```ts
// src/lib/authorize-preview.ts — server-only
import { authorizePreviewRequest } from 'payload-live-preview/server';

export const authorizePreview = (request: Request) =>
  authorizePreviewRequest(request, {
    type: 'payload-session',
    serverURL: import.meta.env.PAYLOAD_URL,
  });
```

```ts
// src/pages/payload/fragment.ts
import { createFragmentEndpoint } from 'payload-live-preview/astro';
import Hero from '../../components/Hero.astro';
import { authorizePreview } from '../../lib/authorize-preview';

export const prerender = false;

export const POST = createFragmentEndpoint({
  authorizePreview,
  registry: {
    hero: {
      component: Hero,
      props: ({ fields, locale }) => ({
        title: String(fields.title ?? ''),
        tagline: typeof fields.tagline === 'string' ? fields.tagline : undefined,
        body: fields.body,
        locale,
      }),
    },
  },
});
```

#### First-use Astro resources

A successful isolated container render does not register the component's CSS
with the page. On the measured Astro 7.3.2 production path, a component imported
only by the endpoint produces scoped markup but no matching page stylesheet.

Use a finite, application-owned catalog in both the page and the endpoint.
Render the catalog wrapper even when the current document contains no blocks;
the wrapper's static imports then remain in Astro's page build graph:

```astro
---
// Blocks.astro
import Card from './Card.astro';
interface Props { show: boolean; title: string }
const { show, title } = Astro.props;
---
{show && <Card title={title} />}
```

The page renders `<Blocks show={false} title="" />` inside its empty fragment
boundary; its endpoint registers that same `Blocks` component and computes
`show` and `title` from authorized input. Do not conditionally omit the wrapper
itself or copy generated scope hashes. For a CSP that requires external CSS,
set `build: { inlineStylesheets: 'never' }` in the Astro configuration. This
loads the catalog CSS up front, not on demand. The page and native router own
its lifetime; removing one preview client does not remove shared CSS.

The executable strict-CSP reference also declares the existing announcer's
`payload-live-preview-a11y` live region with external CSS before starting the
client, and the announcer adopts it. Without it, the package creates its own
region and hides it through `element.style`, which a `style-src 'self'` policy
does not refuse; so does the unbound-fields overlay. Announcements stay enabled
in the reference; neither the sanitizer nor CSP is relaxed.

See [ADR 0020](architecture/0020-astro-page-owned-resources.md) and
[the native resource tests](../tests/e2e/continuation/astro-resources.spec.ts).
This is a measured recipe, not automatic discovery of arbitrary runtime
assets. The default container still passes props only; request URL, params,
trusted locals and extra renderer setup require the existing application
`render` override. Never copy browser-provided locals or headers wholesale.
This recipe is measured in native production on exact Astro 4.16.19, 5.18.2,
6.4.8 and 7.3.2 in all three browsers. Astro 4 uses the original
`ViewTransitions` export for the same native navigation owner. Additional
framework hydration and untested versions remain separate verification work.

The retained pre-fix archive reproduces a default-renderer bug on exact Astro
4.9.0: its Container API does not consume `props`, so the endpoint returns
HTTP 200 without the requested unsaved component. The current source-built
hardening archive corrects this with an internal Astro-compiled template that
forwards registry-selected props through fresh Container `locals`. It needs no
application `render` override, new public entry or extra build configuration.
The [native contract](../tests/e2e/continuation/astro-resources.spec.ts) runs
this default path at pinned Astro versions, 4.9.0 included.

For this exact floor, an explicit application renderer can pass the fixed
catalog's data through the public Container `locals` option. A statically
imported `.astro` wrapper reads that typed value and passes ordinary props to
the catalog. The production reference is split into the
[wrapper](../tests/fixtures/astro-resource-locals/src/components/LocalCatalog.astro.fixture),
[locals type](../tests/fixtures/astro-resource-locals/src/catalog-env.d.ts.fixture)
and [endpoint](../tests/fixtures/astro-resource-locals/src/pages/payload/resource-fragment.ts.fixture).
It validates the registered component identity and data fields, derives context
from verified authorization, and gives each render fresh locals. It never
copies browser-selected locals or component names into the container.

This explicit recipe passes the same nine native resource/context/lifetime
cases on both Astro 4.9.0 and 7.3.2, in Chromium, Firefox and WebKit. The page
still owns the finite catalog's CSS and live region. It is not selected by the
package default and was not itself a repair for PHD-04. It remains useful when
the component needs verified page context. Neither it nor the default bridge
claims support for arbitrary runtime modules or additional hydration.

The normally built source archive passes the two-revision, resource,
registry-props and owner-lifetime cases on exact Astro 4.9.0, 4.16.19, 5.18.2,
6.4.8 and 7.3.2 in Chromium, Firefox and WebKit. It includes the internal
template and regenerated source maps. Public exports and optional peers are
unchanged; an explicit custom renderer still avoids loading the default.
[ADR 0020](architecture/0020-astro-page-owned-resources.md) defines the patch
boundary. This dirty checkpoint is not a released package. Do not deploy the
earlier private archive prototype, which still has its experimental stale map.
Verified page context and additional framework hydration remain separate.

For an additional React child, the native reference pins Astro 7.3.2,
`@astrojs/react` 6.0.6 and React/React DOM 19.2.8. The app integration alone
does not configure a separately created fragment container: its explicit
renderer registers `@astrojs/react/server.js` with the public
`addServerRenderer` method. See the
[endpoint](../tests/fixtures/astro-react-resources/src/pages/payload/resource-fragment.ts.fixture)
and [native contract](../tests/e2e/continuation/astro-react-resources.spec.ts).
Two unsaved revisions, computed external CSS and verified request-local React
provider values pass in Chromium, Firefox and WebKit. Omitting that registration
produces HTTP 500 in the same native fixture.

Without a `client:*` directive this produces React server HTML, not an
interactive React root in each updated fragment. The page eagerly includes the
finite shared catalog's CSS. Page providers, executable module names and
resource URLs are not copied from form data.

A fragment component can also contain a `client:*` island. Its container then
needs three things: the framework's server renderer, its client renderer, and
`resolve: resolveIslandModule`, which maps each island module to the URL this
build emitted. `livePreview()` in the Astro integrations writes that table into
the server build during `astro build`; pass `autoInject: false` when the page
delivers the runtime itself.

```ts
import reactRenderer from '@astrojs/react/server.js';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { resolveIslandModule } from 'payload-live-preview/astro';

const container = await AstroContainer.create({ resolve: resolveIslandModule });
container.addServerRenderer({ renderer: reactRenderer });
container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
```

Fragment scripts never run, so the page itself must load Astro's island runtime
for each directive a fragment island uses; rendering the finite catalog with
that directive does. `LP0809` reports an island the page cannot start. Later
revisions reach the same island through Astro's own props handoff, so React
keeps its state; a different component, changed slot content or an island the
revision removes is replaced or released. A module the build did not emit, or a
build without the table, fails the render instead of sending a source path.
This is measured on Astro 7.3.2 with `@astrojs/react` 6.0.6 in three browsers
([native contract](../tests/e2e/continuation/astro-islands.spec.ts),
[ADR 0021](architecture/0021-fragment-islands-hydrate-from-the-build.md)).
`resolve` needs Astro 4.16 or later, and `astro dev` is not supported yet.

The finite page-owned native React recipe now has a separate
[24-case native contract](../tests/e2e/continuation/astro-owner.spec.ts) on
exact Astro 7.3.2 / `@astrojs/react` 6.0.6 / React 19.2.8. The unreleased
PHD-05 core correction restores island events beside fragment work without
duplicate fallback delivery. PHD-06 is application glue: a
[page-owned store](../tests/fixtures/astro-react-owned/src/client/island-snapshots.ts.fixture)
subscribes before the preview client starts, and React subscribes before reading
the latest selected snapshot. Real delayed module loading, newer revisions,
scope checks, abort, remount and native router disposal pass in three browsers.
The recipe covers islands the page renders outside its fragments; it does not
turn package completion into a React commit signal. See
[ADR 0020](architecture/0020-astro-page-owned-resources.md) for finite ownership
and its limits. Do not substitute
a dummy text binding or guessed hydration delay for the handoff.

The fragment strategy accepts HTML from the registered trusted server renderer;
it does not route that HTML through the rich-text sanitizer. Keep component and
resource selection server-owned and escape editor values. A fragment-render
event does not acknowledge a React commit. The measured recipe uses finite
page-owned framework roots that explicitly consume island updates; do not
execute scripts or resolve browser-selected modules from fragment responses.

### Next.js

The same endpoint as an App Router route handler. `defineFragment()` pairs a
component with the props it takes, so a renamed prop is a type error here
instead of an empty boundary in the preview:

```ts
// app/payload/fragment/route.ts
import { createFragmentEndpoint, defineFragment } from 'payload-live-preview/nextjs';
import { Hero } from '@/components/Hero';
import { authorizePreview } from '@/lib/authorize-preview';

export const POST = createFragmentEndpoint({
  authorizePreview,
  registry: {
    hero: defineFragment(Hero, ({ fields, locale }) => ({
      title: String(fields.title ?? ''),
      tagline: typeof fields.tagline === 'string' ? fields.tagline : undefined,
      locale,
    })),
  },
});
```

Rendered with `renderToString()` from `react-dom/server`, which renders one
synchronous component: a server component that awaits its own data is not one
of these — read what it needs in `props`, which may be async, and keep the
component itself synchronous. `react` and `react-dom` are optional peers
imported at the first render, so a project that registers no fragment never
loads them.

### SvelteKit

`+server.ts` exports the endpoint as its `POST`; the handler takes the event
SvelteKit hands it.

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

Rendered with `render()` from `svelte/server`, and only its `body`: what a
component puts in `<svelte:head>` belongs to the document head, which the route
strategy owns. `svelte` is an optional peer imported at the first render.

That import names `svelte/server` outright, unlike the other bindings' hidden
specifiers, and it has to: Svelte keeps the current component context in a
module variable, and a component compiled by Vite reaches it through Vite's own
module graph. A copy resolved past the bundler would be a second instance with
an empty context, and every render would fail on it. If one ever does — a build
that externalizes this package without also externalizing `svelte`, say — add
`ssr: { noExternal: ['payload-live-preview'] }` to `vite.config.ts` so both come
from the same graph.

### Nuxt

Nitro hands a route handler an H3 event rather than a `Request`, so the endpoint
is wrapped once:

```ts
// server/routes/payload/fragment.post.ts
import { createFragmentEndpoint } from 'payload-live-preview/nuxt';
import Hero from '../../../components/Hero.vue';
import { heroProps } from '../../../lib/hero';

const endpoint = createFragmentEndpoint({
  authorize: { type: 'signed-token', secret: TOKEN_SECRET, audience: SITE_ORIGIN },
  registry: { hero: { component: Hero, props: ({ fields }) => heroProps(fields) } },
});

export default defineEventHandler((event) => endpoint(toWebRequest(event), event));
```

Rendered with `renderToString()` from `vue/server-renderer`, one SSR app per
render because an app carries the props it was created with. `vue` is an
optional peer imported at the first render.

One build note: the component is rendered inside the Nitro bundle, and Nitro's
rollup does not know what a single-file component is. Teach it once —

```ts
// nuxt.config.ts
import vue from '@vitejs/plugin-vue';
export default defineNuxtConfig({ nitro: { rollupConfig: { plugins: [vue()] } } });
```

— or write the fragment's component as a `defineComponent` in a `.ts` file,
which Nitro reads as it is.

### Another component system

`render` replaces the binding's renderer and leaves the rest of the endpoint
alone. Import the one whose route shape matches your framework — its component
type is `object` everywhere except Next.js, so a Solid, Qwik or Lit component
fits — and the default renderer is only imported when it actually runs, so a
project that passes `render` never loads the peer it would have used:

```ts
import { createFragmentEndpoint } from 'payload-live-preview/astro';
import { createSSRApp, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import Hero from './Hero.vue';

export const POST = createFragmentEndpoint({
  authorize: { type: 'signed-token', secret: TOKEN_SECRET, audience: SITE_ORIGIN },
  registry: {
    hero: { component: Hero, props: ({ fields }) => ({ title: String(fields.title ?? '') }) },
  },
  render: (component, props) => renderToString(createSSRApp(component as Component, props)),
});
```

The response then reports `renderer: 'custom'` in its metadata. A framework
whose route handler is not `Request` → `Response` wraps the returned function
in whatever it does hand a handler — that is all either binding does.

### What both decide

- **Registry**: the only things the endpoint can render. Props are computed
  on the server from the request's fields; nothing in the request selects
  code.
- **Authorization**: `authorizePreview` is the middleware's hook — same type,
  same rules; a context `authorizePreviewRequest()` produced authorizes,
  anything else refuses. When there is no hook to share, `authorize` takes a
  strategy instead, exactly as `authorizePreviewRequest()` does
  (`authorize: { type: 'signed-token', secret: import.meta.env.PREVIEW_TOKEN_SECRET, audience: import.meta.env.SITE_ORIGIN }`).
  One of the two is required and they are exclusive. The endpoint
  authorizes the **page route** the browser reports, with the request's own
  cookies and query, so a token stays bound to the route it was issued for
  and a session is the visitor's own. There is no unsigned endpoint.
  The strategies are described in [docs/authorization.md](authorization.md).
- **Renderer**: the imported binding's own, loaded once per process at the
  first render and forgotten again if that import failed, so a project that
  installs the peer afterwards is not answered from a stale failure. Pass
  `render` for another component system or for a test.
- **Limits**: the endpoint counts the bytes consumed from the request stream,
  with a 64 KiB default cap. One 5 s deadline covers the complete body read;
  props and rendering then receive separate 5 s windows. Configure these with
  `limits` (`bodyBytes`, `timeoutMs`); field depth 12 is fixed. `Content-Length`
  can refuse early but cannot bypass the streamed cap. Every response is
  `Cache-Control: private, no-store`.
- **Request lifetime**: set `limits.totalTimeoutMs` for one deadline covering
  body reading, authorization, props and rendering together, for example
  `limits: { totalTimeoutMs: 6000 }`. It is disabled by default and does not
  replace the separate `timeoutMs` windows. Values must be positive safe
  integers no greater than `2147483647`. The handler returns
  `504 {"error":"timeout"}` at this deadline. A client abort after body reading
  returns `400 {"error":"request"}`; a disconnected client may never receive
  that response.
- **Native HTTP/1 transport**: pass the whole SvelteKit event to its handler,
  and the H3 event as the Nuxt handler's second argument. These bindings link
  socket closure to the request lifetime, including after upload. An unread
  body is paused without cancelling the host's response socket; the refusal
  uses `Connection: close` so it can flush without draining an unbounded tail.
  Fully consumed requests retain keep-alive. HTTP/2 and non-Node hosts use
  their Web request's signal instead; a proxy must propagate disconnects to
  its upstream connection for the server to observe them.
- **Cooperative cancellation**: pass `input.signal` from props or a custom
  renderer into fetches and other work that supports `AbortSignal`. The page
  request passed to authorization follows the same lifetime. No following
  phase starts after cancellation, and a late result is not accepted. Work
  that ignores the signal can continue; synchronous code cannot be interrupted
  by these timers. Host execution and concurrent-request limits are still
  required for a hard resource bound.
- **A render that throws** answers `500 {"error":"render"}` — the reason never
  leaves the server — and logs the boundary's id and the message once per
  process, outside production. Without that line a component that throws on
  every request looks like a network fault from the browser. The runtime
  patches the boundary from the same revision and reports `LP0801`.

### What a deployment needs

- A route the framework actually serves. In Astro, files under `src/pages/`
  whose path starts with `_` are private and never routed, so the endpoint
  belongs at `src/pages/payload/fragment.ts` (`/payload/fragment`), not under
  `_payload`. In Next.js it is `app/payload/fragment/route.ts`, and the path
  follows the directory.
- A server to render in: an Astro SSR adapter (`@astrojs/node`, Vercel, …)
  with `prerender = false` on the route, or a Next.js deployment that is not a
  fully static export. A static-only build has no process; run the endpoint as
  a separate preview rendering service on the same origin (a reverse proxy
  path) if the site itself is static.
- Rate limiting at the edge or proxy for the endpoint path: each request
  renders a component. The endpoint bounds work per request (limits above)
  but does not count requests per client.
- Same-origin only. A request whose `Sec-Fetch-Site` is anything but
  `same-origin` (or `none`) is refused before `Origin` is read, and the
  runtime's fragment client only posts to a path on the page's own origin.
  `allowedOrigins` on the endpoint admits a named `Origin` only for a client
  that sends no `Sec-Fetch-Site`; it does not open the endpoint to a preview
  page served elsewhere.

## Turning it on in the page

Astro, request-time injection:

```ts
// src/middleware.ts
import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
import { authorizePreview } from './lib/authorize-preview';

export const onRequest = createLivePreviewMiddleware({
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  authorizePreview,
  fragments: { endpoint: '/payload/fragment' },
});
```

With `fragments` set, the injected script carries a small prelude with the
fragment client ahead of the runtime; a page without it gets the runtime
alone. The Astro integration (`livePreview()`) takes the same option in every
mode; loader mode emits the prelude in the bootstrap, and the runtime asset
stays the same for every page. Every adapter takes the same
`fragments` option — `livePreviewScriptProps()` in a Next.js layout
([nextjs.md](nextjs.md)), the SvelteKit handle, the Nuxt plugin — because the
option only names a path the runtime posts to, whoever serves it.
`generateInlineScript()` calls it `fragmentEndpoint`. `LivePreviewClient` takes
`strategies` instead:
`{ fragment: createFragmentStrategy({ endpoint }), route: createRouteStrategy() }`
from `payload-live-preview/fragment`.

### The route strategy on its own

A page that wants route refreshes and no server-rendered boundaries sets
`routeStrategy: true` instead — in `generateInlineScript()` and in every
adapter's options. The script then carries a second, smaller prelude with the
route strategy alone: 2 176 bytes gzip against the fragment prelude's 3 753,
because the endpoint request, the fragment protocol and its abort scaffolding
stay behind.

That is the option for `data-payload-strategy="route"` and for bindings in
`<head>` on a page whose script names no fragment endpoint. Setting
both is not an error and not a double cost: `fragmentEndpoint` wins, and its
prelude already contains the route strategy.

## A change nothing binds

Patching reaches what the markup annotates. Edit a field with no
`data-payload-field` anywhere and the preview shows the old value — the runtime
has nowhere to put the new one. A framework hook that re-renders the component
tree does not have that failure mode, and that is the one thing it does better.

A strategy to escalate to closes it, and nothing else is needed — escalating is
what `onUnfaithfulPatch` does by default:

```ts
// astro.config.mjs reads process.env: import.meta.env has no PUBLIC_ variables there (docs/astro.md)
livePreview({
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
  mergeDepth: 1,
  routeStrategy: true,
});
```

A revision that changes a field no binding covers then refreshes the whole
route. The built-in strategy reapplies every reachable binding; server-owned
output stays saved unless the host renderer knows the unsaved revision. Where a
binding exists the page is still patched in place, with focus and scroll intact.

The same decision covers the other ways a patch falls short of the server's own
render: a value no renderer can represent, and a Lexical block whose markup the
write has to drop. Those name an element, so they escalate to the fragment
boundary around it when there is one, and to the route when there is not — once
per element, because the cause is the markup rather than the edit.

What counts as covered: a binding on the field, on the same field under the
message's locale suffix, or on a path inside it — `data-payload-field="hero.eyebrow"`
covers the field `hero`, because the diff names top-level fields. The document
fields Payload sends with every update (`id`, `updatedAt`, `_status` and their
kin) never count, and neither does the connection's first message, where every
field looks changed and the page was just rendered from them.

The refresh is throttled by the route strategy's own `minIntervalMs` (1 s by
default), and a revision refreshes at most once — a second attempt is refused
as `LP0805`. A page that binds little and edits much will still refresh often;
that is the trade, and `onUnfaithfulPatch: 'warn'` is the other side of it: the
same findings, reported as `LP0411`, with the patch left where it is.

A refresh still running when the next revision arrives keeps running: the
route is the server's, so the refresh lands for that revision and the runtime
re-applies it onto the fresh markup. Only a revision that needs a refresh of
its own replaces the running one. A fragment render carries the revision's
fields, so a newer revision aborts it instead, and renders the boundary again
even when its own changes lie outside it.

## What you observe

- `fragmentRender` events per boundary and revision (`rendered` / `failed`
  with the code); `afterUpdate` carries `source: 'fragment'` once the
  revision's fragments settled, next to the `source: 'patch'` one for the
  rest of the page.
- `inspect().fragments`: `{ handler, inFlight, rendered, failed, superseded }`.
- `inspect().fidelity`: `{ mode, unfaithful, escalated, fields }` — every
  finding of this kind, and how many of them a strategy was handed: the patches
  the runtime knew could not match the server (LP0411), once per binding, and
  the changed fields it had no binding for at all, once per field.
  `unfaithful` above `escalated` with both `handler`s `false` is a page that
  keeps degraded patches for want of a strategy.
- Codes: `LP0801` request failed (network, timeout, or any non-2xx status
  but 401/403 — the endpoint's own 400, 404, 405, 408, 413, 415 and 500 too) · `LP0802`
  response invalid (type, shape, size, wrong boundary) · `LP0803` endpoint
  refused (401/403) · `LP0804` a late response for a superseded revision
  was discarded · `LP0805` a route refresh was refused by the loop guard ·
  `LP0806` a boundary asks for `fragment` but no client is configured —
  patched instead.

## The route strategy

Some markup no boundary can own: the document head (title, meta), the
layout, route params, global providers. A binding there — anything in
`<head>`, or an element marked `data-payload-strategy="route"` (with
`data-payload-depends` naming its fields) — makes the revision a **route
refresh**: the runtime fetches the current URL again (same cookies and
query, header `x-payload-live-preview: route`), syncs `<title>`, `<meta>`
and the canonical link, morphs `<body>` in place (islands and custom
elements are boundaries it does not cross), rescans, and re-applies the
revision so the unsaved state lands on the fresh markup. Compatible retained
nodes keep their live properties, and a retained keyed move restores focus;
replaced nodes lose their state. The head sync mirrors the fresh document both
ways: a named `<meta>` or the canonical `<link>` that the server no longer
renders is removed, because the refresh is that server's own render of this URL.
Mark a tag your own script owns with `data-payload-owned` and the sync
leaves it alone in both directions. At most one refresh per revision; a
second request for the same revision, or one inside `minIntervalMs` (1 s) of
the previous, is refused with `LP0805` and the elements are patched instead.
A failed refresh (`LP0801`/`LP0802`) also falls back to patching.

The GET and a registered host refresh receive no live-preview fields. The
built-in strategy therefore reports `partial`: the runtime reapplies every
binding it can reach, but conditional, derived, unbound, head, or other
server-owned output may still reflect saved data. `refreshed` is reserved for
a custom strategy that can assert its renderer knew the current unsaved
revision. See [ADR 0018](architecture/0018-route-refresh-fidelity.md).

The route strategy needs no endpoint: with `fragments` configured the
injected prelude carries it (`createRouteStrategy()` from
`payload-live-preview/fragment` for `LivePreviewClient` users). The server
sees a normal GET for the page, so anything that renders the page renders
the refresh.

## How a binding's strategy is chosen

In this order, and nothing else decides:

1. An explicit `data-payload-strategy` (`patch`, `fragment`, `route`; any
   other value is left alone with `LP0407`).
2. A binding inside a `data-payload-fragment` boundary belongs to the
   fragment (patched only as its fallback).
3. A binding in `<head>` belongs to the route.
4. Everything else is patched.

Several dirty fields in one revision are coalesced: each boundary renders
once if any of its `data-payload-depends` (or, without it, any field)
changed, the runtime `dependencies` option counts (a boundary depending on a
derived field re-renders when its source changes), and the route refreshes
once. `inspect().route` reports
`{ handler, refreshes, partial, failed, refused, loopStopped }`; `partial` is
the successful subset whose renderer was not proven to know the current
unsaved revision.

The strategy refreshes at most once per `minIntervalMs` (1 000 ms). A request
inside that window is not dropped: it is counted in `refused`, the page is
patched with what it can show in the meantime, and the refresh runs once when
the window closes — so the keystroke that ends a burst still reaches the
preview. A newer revision takes that pending run over, because its message
carries the older one's values too.

## Islands on the same page

A hydrated island (`<astro-island>`, `data-payload-island`) keeps owning its
subtree: patching skips it, a fragment boundary inside it is never planned,
the route and fragment morphs never enter it (an `<astro-island>` they keep
takes rendered props through Astro's own handoff, ADR 0021), and it re-renders itself from a
`payload-live-preview:update` event — or with the official
`@payloadcms/live-preview-react`/`-vue` hook if that is what renders it
([docs/interop.md](interop.md)). The event follows every flush that carried a
change, whether or not a binding outside the islands was written — a page whose
bindings all sit inside islands still hears every edit
([docs/renderers.md](renderers.md#islands)). Patch boundaries, fragment boundaries and
hook islands coexist on one page.

## Revision discipline

One revision per admin message. A newer message aborts the previous
revision's fragment requests; a response that arrives late is discarded;
identical boundaries in one revision share a request; at most four
requests run at once (`maxConcurrent` on `createFragmentStrategy()`). Slow
fragment A can never overwrite fast fragment B.
