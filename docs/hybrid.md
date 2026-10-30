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

- `data-payload-fragment="hero"` — a **registry id** (`[a-z][a-z0-9-]*`, at
  most 64 characters). Never a path or a module name: the server decides what
  `hero` renders.
  `createPreviewBindings().boundary('hero', { dependsOn: [...] })` writes these
  three attributes from the request's authorization, so an unauthorized response
  carries no boundary either ([bindings.md](bindings.md#keeping-binding-attributes-off-public-responses)).
  It throws a `RangeError` for any other id, and for a `key` that is empty or
  longer than 128 characters.
- `data-payload-depends` — the fields that re-render the boundary. Without
  it, every update does.
- `data-payload-fragment-key` — when one id renders several boundaries on a
  page (one per list item, say).
- The id and key are the boundary's identity, not the element. A component
  that re-renders its region while a render is in flight may replace the
  element; the render, or the fallback patch, then goes to the replacement.
  When two boundaries on the page carry that id and key, it goes to neither
  ([ADR 0011](architecture/0011-fragment-protocol-and-abuse-model.md#1a-a-boundary-replaced-while-its-render-is-in-flight-2026-10-02)).
- Bindings inside the boundary still work as the **fallback**: if the
  server cannot render (network, timeout, refusal, bad response), the
  runtime patches them from the same revision and reports an `LP08xx`
  code. What the bindings do not cover (a derived value, a conditional section)
  keeps the previous server render until a render succeeds, and
  `inspect().revisions.display` says `partial` with the shortfall named.

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

#### What `props` receives

`props` is called with the boundary's `id` and `key`, the `revision`, the
unsaved `fields`, `locale`, `collectionSlug` and `globalSlug`, the page `route`,
the request's verified `authorization`, an abort `signal`, the `request` itself,
and `locals`: what the framework's own server code put on the fragment request,
as a page's `load` or middleware sees it on the page request. That is
Astro's `context.locals`, SvelteKit's `event.locals` and Nuxt's
`event.context`; Next.js has no such object, so `locals` is `undefined` there.
It is typed `unknown`, so narrow it to the application's own type. It holds
what server code set, nothing from the request body
([ADR 0029](architecture/0029-fragment-components-and-locals-belong-to-the-page.md)).

#### Bindings inside a fragment component

A component inside a boundary is rendered twice over: by the page for every
visitor, and by the endpoint for an authorized preview. Its bindings have to
follow the request that renders it, so hand them in as props built from that
request's verdict: on the page from the adapter's decision, in the endpoint
from `authorization`, which is always a verified context there. A component
that reads the verdict itself, from `Astro.locals` say, sees none inside the
endpoint's render (Astro's container passes props only), renders without
bindings, and the morph then removes them from the page.

```ts
// src/lib/hero-bindings.ts — used by the page and by the endpoint
import { createPreviewBindings, type AuthorizedPreviewContext } from 'payload-live-preview';

export function heroBindings(authorization: AuthorizedPreviewContext | null) {
  const preview = createPreviewBindings({ authorization });
  return { title: preview.bind('title'), subtitle: preview.bind('subtitle') };
}
```

The page passes `bindings={heroBindings(Astro.locals.livePreviewAuthorization ?? null)}`,
the registry entry `props: ({ fields, authorization }) => ({ ...heroProps(fields), bindings: heroBindings(authorization) })`,
and the component spreads them: `<h1 {...bindings.title}>{title}</h1>`. A
public response then carries no binding attributes, and the endpoint's render
carries the same ones as the page in a preview.

#### First-use Astro resources

The Astro results below are dated measurements on earlier source-built
archives, recorded in [ADR 0020](architecture/0020-astro-page-owned-resources.md)
on 2026-09-27 and [ADR 0021](architecture/0021-fragment-islands-hydrate-from-the-build.md)
on 2026-09-28. The specs named below are what runs today. Three jobs run from
the package archive on every push, in Chromium: base integration on Astro
4.0.0, fragment islands on 4.16.19, and fragment rendering with page-owned
resources on 4.9.0, 4.16.19, 5.18.2, 6.4.8, 7.3.2 and 7.4.4. The other
engines, the islands on 7.3.2, verified React context and page ownership
are run by hand ([Astro peer floors](testing.md#astro-peer-floors)).

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
The 2026-09-27 recipe measurements used exact Astro 4.16.19, 5.18.2, 6.4.8
and 7.3.2 in all three browsers. Astro 4 uses the original
`ViewTransitions` export for the same native navigation owner. Additional
framework hydration and untested versions remain separate verification work.

On exact Astro 4.9.0 the Container API does not consume `props`. Measured on
2026-09-27 with an archive from before the correction, the default renderer then
answered HTTP 200 without the requested unsaved component; that archive is not
part of the current checks. The correction uses an internal
Astro-compiled template that forwards registry-selected props through fresh
Container `locals`. It needs no
application `render` override, new public entry or extra build configuration.
The [native contract](../tests/e2e/continuation/astro-resources.spec.ts) keeps
this default path separately selectable at pinned Astro versions.

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

The explicit recipe's 2026-09-27 measurements passed nine native
resource/context/lifetime cases on Astro 4.9.0 and 7.3.2, in Chromium, Firefox
and WebKit; the [contract](../tests/e2e/continuation/astro-resources.spec.ts)
lists four cases per browser today. The page
still owns the finite catalog's CSS and live region. It is not selected by the
package default and was not itself the repair of the default-renderer defect on
Astro 4.9.0. It remains useful when
the component needs verified page context. Neither it nor the default bridge
claims support for arbitrary runtime modules or additional hydration.

The normally built bridge archive measured on 2026-09-27 passed the
two-revision, resource, registry-props and owner-lifetime cases on exact Astro
4.9.0, 4.16.19, 5.18.2, 6.4.8 and 7.3.2 in Chromium, Firefox and WebKit. It
included the internal template and regenerated source maps. Public exports
and optional peers are unchanged; an explicit custom renderer still avoids
loading the default. [ADR 0020](architecture/0020-astro-page-owned-resources.md)
defines the patch boundary. Verified page context and additional framework
hydration remain separate.

For an additional React child, the native reference pins Astro 7.3.2,
`@astrojs/react` 6.0.6 and React/React DOM 19.2.8. The app integration alone
does not configure a separately created fragment container: its explicit
renderer registers `@astrojs/react/server.js` with the public
`addServerRenderer` method. See the
[endpoint](../tests/fixtures/astro-react-resources/src/pages/payload/resource-fragment.ts.fixture)
and [native contract](../tests/e2e/continuation/astro-react-resources.spec.ts).
Two unsaved revisions, computed external CSS and verified request-local React
provider values pass in Chromium, Firefox and WebKit. The helper can build the
same fixture without that registration (`PLP_ASTRO_RESOURCE_RENDERER=react-unconfigured`)
as a counterexample; no spec asserts what that build answers.

Without a `client:*` directive this produces React server HTML, not an
interactive React root in each updated fragment. The page eagerly includes the
finite shared catalog's CSS. Page providers, executable module names and
resource URLs are not copied from form data.

A fragment component can also contain a `client:load` island. Its container then
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
container.addServerRenderer({ name: reactRenderer.name, renderer: reactRenderer });
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
[ADR 0021](architecture/0021-fragment-islands-hydrate-from-the-build.md)), for
React islands with `client:load`. The other directives (`client:idle`,
`client:visible`, `client:media`, `client:only`) and the clients of other
frameworks are not measured. `resolve` is a container option of Astro 4.16 and
later, and the island lane runs Astro 7.3.2 and 4.16.19; earlier versions are
not claimed, and neither is `astro dev`. Without the build's table the render
refuses with a message that names `livePreview()` and `astro build`
([unit test](../tests/unit/adapters/astro-island-modules.test.ts)).

The finite page-owned native React recipe now has a separate
[native contract](../tests/e2e/continuation/astro-owner.spec.ts) of eight cases
per browser (24 runs in three browsers) on exact Astro 7.3.2 /
`@astrojs/react` 6.0.6 / React 19.2.8. A core correction restores island events
beside fragment work without duplicate fallback delivery. What remains is
application glue: a
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

That import names `svelte/server` outright, unlike the Astro and Nuxt bindings,
which import theirs through a variable, and it has to: Svelte keeps the current
component context in a module variable, and a component compiled by Vite reaches
it through Vite's own module graph. A copy resolved past the bundler would be a
second instance with an empty context, and every render would fail on it. If one
ever does — a build that externalizes this package without also externalizing
`svelte`, say — add `ssr: { noExternal: ['payload-live-preview'] }` to
`vite.config.ts` so both come from the same graph.

### Nuxt

Nitro hands a route handler an H3 event rather than a `Request`, so the endpoint
is wrapped once (`TOKEN_SECRET` and `SITE_ORIGIN` stand for the secret the Payload
side shares for signed tokens and this site's own origin, see
[authorization.md](authorization.md)):

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
rollup does not know what a single-file component is. Teach it once with
`fragmentComponentPlugins()` from `payload-live-preview/nuxt-module` (the setup,
and why it needs `srcDir`: [nuxt.md](nuxt.md#server-rendered-boundaries)), or
write the fragment's component as a `defineComponent` in a `.ts` file, which
Nitro reads as it is.

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
  code. An id the registry does not hold is answered `404 {"error":"fragment"}`.
- **Authorization**: `authorizePreview` is the middleware's hook — same type,
  same rules; a context `authorizePreviewRequest()` produced authorizes,
  anything else refuses. When there is no hook to share, `authorize` takes a
  strategy instead, exactly as `authorizePreviewRequest()` does
  (`authorize: { type: 'signed-token', secret: import.meta.env.PREVIEW_TOKEN_SECRET, audience: import.meta.env.SITE_ORIGIN }`).
  One of the two is required and they are exclusive. The endpoint
  authorizes the **page route** the browser reports, with the request's own
  cookies and query, so a token stays bound to the route it was issued for
  and a session is the visitor's own. There is no unsigned endpoint.
  A context bound to a locale refuses a request for another locale, and one
  bound to a Payload document (`scope.payload`) refuses another document; both
  answer `403 {"error":"unauthorized"}`
  ([authorization.md](authorization.md#bind-a-verifier-to-one-payload-document)).
  The strategies are described in [docs/authorization.md](authorization.md).
- **Renderer**: the imported binding's own, loaded once per process at the
  first render and forgotten again if that import failed, so a project that
  installs the peer afterwards is not answered from a stale failure. Pass
  `render` for another component system or for a test.
- **Limits**: the endpoint counts the bytes consumed from the request stream,
  with a 64 KiB default cap. One 5 s deadline covers the complete body read
  (`408 {"error":"body"}` when it passes); props and rendering then receive
  separate 5 s windows (`500 {"error":"render"}` when one passes). Configure these with
  `limits` (`bodyBytes`, `timeoutMs`). The request
  carries the whole document: 64 KiB holds at least about 4 500 words of rich text,
  and a page with layout blocks measured 6 to 15 KB
  ([ADR 0027](architecture/0027-fragment-requests-within-measured-bounds.md)).
  A larger document is answered 413 and patched instead (`LP0801`); raise
  `bodyBytes` for it. `Content-Length`
  can refuse early but cannot bypass the streamed cap. Every response is
  `Cache-Control: private, no-store`.
- **Field depth**: the default and hard ceiling are 64. Set
  `limits: { fieldDepth: 24 }` for a stricter cap. `fieldDepth` must be an
  integer from 0 through 64; invalid configuration throws `TypeError` when
  the endpoint is created. Depth starts at 0 for `fields`; each object
  property or array element adds one level, including primitive values.
  A cap of 0 accepts only an empty record. An otherwise valid request beyond
  a cap of 24 receives `400 {"error":"field-depth","maxDepth":24}` before
  authorization. Other invalid shapes receive `400 {"error":"shape"}`.
  Either failure becomes `LP0801` and patches the same revision. This JSON
  nesting limit is separate from Payload REST population `depth`.
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
  uses `Connection: close` so it can flush without draining an unbounded tail,
  and a client still sending can see a network error instead of the 413 (WebKit
  and Firefox, measured in
  [Deployment](deployment.md#the-fragment-endpoint-behind-a-proxy)). Fully
  consumed requests retain keep-alive. HTTP/2 and non-Node hosts use their Web
  request's signal instead (Deno fails the body stream of a dropped upload and
  leaves the signal alone); a proxy must propagate disconnects to its upstream
  connection for the server to observe them, and nginx, Caddy and Traefik do.
- **Cooperative cancellation**: pass `input.signal` from props or a custom
  renderer into fetches and other work that supports `AbortSignal`. The page
  request passed to authorization follows the same lifetime. No following
  phase starts after cancellation, and a late result is not accepted. Work
  that ignores the signal can continue; synchronous code cannot be interrupted
  by these timers. Host execution and concurrent-request limits are still
  required for a hard resource bound. Cancelling saves the phases that have not
  started, not the host's cost of taking a request: in capacity measurements on
  2026-10-22 and 2026-10-23 (one client against a Next.js 16 server, in three engines), a burst in which 76 of 80 requests were cancelled before rendering
  cost 1.6 to 2.1 ms of server CPU per request, about what completed requests of
  the same size cost (1.7 to 1.95 ms).
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
  follows the directory. With `trailingSlash: 'always'` in `astro.config`, name
  the path with its slash, `fragments: { endpoint: '/payload/fragment/' }`:
  Astro 7.4.2 with the Node adapter answers a POST to `/payload/fragment` with
  a 301 instead of running the endpoint (measured on 2026-10-28), a browser
  follows a 301 with a GET, and the boundary falls back to its patch.
- A server to render in: an Astro SSR adapter (`@astrojs/node`, Vercel, …)
  with `prerender = false` on the route, or a Next.js deployment that is not a
  fully static export. A static-only build has no process; run the endpoint as
  a separate preview rendering service on the same origin (a reverse proxy
  path) if the site itself is static.
- Rate limiting at the edge or proxy for the endpoint path: each request
  renders a component. The endpoint bounds work per request (limits above)
  but does not count requests per client.
- A proxy that lets those limits reach the client. Give it a request body limit
  a little above `limits.bodyBytes`, and stream request bodies if the body
  deadline should run for a slow upload. What each proxy was measured to do,
  and the endpoint on Deno and Bun:
  [Deployment](deployment.md#the-fragment-endpoint-behind-a-proxy).
- Same-origin only. A request whose `Sec-Fetch-Site` is anything but
  `same-origin` (or `none`) is refused before `Origin` is read, and the
  runtime's fragment client only posts to a path on the page's own origin.
  `allowedOrigins` on the endpoint adds `Origin` values accepted when
  `Sec-Fetch-Site` is absent, `same-origin` or `none` — behind TLS termination,
  say, where the server sees an upstream URL and the browser sends the public
  origin. A fetch the browser marks `same-site` or `cross-site` is refused
  whatever the list says, so it does not open the endpoint to a preview page
  served elsewhere.

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
`fragments` option — the options of `LivePreviewScript(…)` in a Next.js layout
([nextjs.md](nextjs.md)), the SvelteKit handle, the Nuxt plugin — because the
option only names a path the runtime posts to, whoever serves it.
`generateInlineScript()` calls it `fragmentEndpoint`. `LivePreviewClient` takes
`strategies` instead:
`{ fragment: createFragmentStrategy({ endpoint }), route: createRouteStrategy() }`
from `payload-live-preview/fragment`.

The lean runtime carries no strategy runner: `runtime: LEAN_RUNTIME` together
with `fragments` (`fragmentEndpoint`) or `routeStrategy` throws when the script
is generated ([options.md](options.md)).

### The route strategy on its own

A page that wants route refreshes and no server-rendered boundaries sets
`routeStrategy: true` instead — in `generateInlineScript()` and in every
adapter's options. The script then carries a second, smaller prelude with the
route strategy alone: about 3.5 KB gzip when compressed separately, against
about 5.5 KB for the fragment prelude,
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

The route strategy answers it, and escalating is what `onUnfaithfulPatch` does
by default:

```js
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
output stays saved unless the host renderer knows the unsaved revision, so an
unbound field still shows its saved value at that point. Once Payload reports the
save (`payload-document-event`, after every save, the autosave included), the
route renders once more and shows it; a second save with nothing new in between
renders nothing more. Without a save, the edit stays out of the preview until
the next one. Where a binding exists the page is still patched in place, with
focus and scroll intact.

The same decision covers the other ways a patch falls short of the server's own
render: a value no renderer can represent, and a Lexical block whose markup the
write has to drop. Those name an element, so they escalate to the fragment
boundary around it when there is one, and to the route when there is not. A
later edit of the same element escalates again, at most once a second per
element, because what the server drew still shows the old value. The value it
was last handed over with is not handed over again, because the re-apply after
a route render gives it to the renderer once more.

What counts as covered: a binding on the field, on the same field under the
message's locale suffix, or on a path inside it — `data-payload-field="hero.eyebrow"`
covers the field `hero`, because the diff names top-level fields. A
`data-payload-covers` declaration counts too, and so does a field that a boundary
or a route marker lists in `data-payload-depends` when the page configures the
strategy that renders it ([bindings.md](bindings.md#what-a-page-accounts-for)).
The document fields Payload sends with every update (`id`, `updatedAt`,
`_status` and their kin) never count, and neither does the connection's first
message, where every field looks changed and the page was just rendered from
them. The first message after a soft navigation (`refreshAfterNavigation()`)
lands on a route the server rendered a moment ago, so it refreshes nothing
either: a field the new route does not bind is rendered once Payload reports
the next save, as after a partial refresh.

The refresh is throttled by the route strategy's own `minIntervalMs` (1 s by
default), and a revision refreshes at most once — a second attempt is refused
as `LP0805`. A page that binds little and edits much will still refresh often;
that is the trade, and `onUnfaithfulPatch: 'warn'` is the other side of it: it
hands nothing to a server and leaves the patch where it is. It reports a patch
that fell short as `LP0411`, once per element. A changed field with no binding
is not one of those: `inspect().fidelity` counts it under every mode, and
`LP0203` names a scalar one (`LP0201` when its value is empty).

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
- `inspect().revisions.display`: whether the page shows the latest accepted
  revision — `pending`, `current`, `partial` with the shortfalls that kept it
  from being current (a boundary that fell back to a patch, with its code; a
  route render that showed the saved draft or failed; a patch or an unbound
  field kept; a write that did not happen; a failed re-fetch) or `unconfirmed`
  while an island has not called `displayed()`. The `revisionDisplay` event
  carries the same record when a revision leaves `pending`, again when its
  islands confirm an `unconfirmed` one, and reports
  `superseded` for one that a newer revision replaced while it was still
  `pending`; with `enableA11y` a partial revision is announced
  ([ADR 0023](architecture/0023-revision-display-state.md)).
- `inspect().fragments`: `{ handler, inFlight, rendered, failed, superseded }`.
- `inspect().fidelity`: `{ mode, canEscalate, unfaithful, escalated, fields }` —
  every finding of this kind, and how many of them a strategy was handed: the
  patches the runtime knew could not match the server (LP0411), once per
  binding, and the changed fields it had no binding for at all, once per field.
  `canEscalate` says whether a fragment or route strategy exists to hand
  anything to (a field with no binding needs the route); `unfaithful` above `escalated` with `canEscalate` `false` is a
  page that keeps degraded patches for want of a strategy.
- Codes: `LP0801` request failed (network, timeout, or any non-2xx status
  but 401/403 — the endpoint's own 400, 404, 405, 408, 413, 415, 500 and 504
  too) · `LP0802` response invalid (type, shape, size, wrong boundary) ·
  `LP0803` endpoint refused (401/403) · `LP0804` a late response for a
  superseded revision was discarded · `LP0805` a route refresh was refused by
  the loop guard or the minimum interval · `LP0806` a boundary asks for
  `fragment` but no client is configured — patched instead · `LP0807` a
  changed field with no binding refreshed the route · `LP0808`
  `onUnfaithfulPatch: 'escalate'` found no fragment or route strategy · `LP0809`
  a fragment inserted an Astro island the page cannot start · `LP0810` a host's
  route refresh returned no promise. What to do about each:
  [troubleshooting.md](troubleshooting.md#diagnostic-codes).

## The route strategy

Some markup no boundary can own: the document head (title, meta), the
layout, route params, global providers. A binding there — anything in
`<head>`, or an element marked `data-payload-strategy="route"` (with
`data-payload-depends` naming its fields) — makes the revision a **route
refresh** when one of those fields changed. A path inside a field
(`meta.title`, `layout.1.note`) changes with its field; under
`subfieldCoverage: 'declared'`, which keeps the previous message, only when the
value at the path does. In a refresh the runtime fetches the current URL again
(same cookies and query, header `x-payload-live-preview: route`), syncs `<title>`, `<meta>`
and the canonical link, morphs `<body>` in place (islands, `data-payload-owned`
subtrees, editable content and custom elements without `data-payload-morph` are
boundaries it does not cross), rescans, and re-applies the
revision so the unsaved state lands on the fresh markup. Compatible retained
nodes keep their live properties, and a retained keyed move restores focus;
replaced nodes lose their state. The head sync mirrors the fresh document both
ways: a named `<meta>` or the canonical `<link>` that the server no longer
renders is removed, because the refresh is that server's own render of this URL.
Mark a tag your own script owns with `data-payload-owned` and the sync
leaves it alone in both directions. Nothing else in the head is synced: the
sync covers `<title>`, `<meta>` with a `name` or `property` and
`<link rel="canonical">`, so a JSON-LD script, preload links and `hreflang`
alternates keep what the page loaded with until the next full load. At most one refresh per revision; a
second request for the same revision, or one inside `minIntervalMs` (1 s) of
the previous, is refused with `LP0805` and the elements are patched instead.
A failed refresh (`LP0801`/`LP0802`) also falls back to patching.

The morph makes each retained element's attributes match the server's
markup. An attribute a script set after the page loaded is removed on the next
fragment or route render, except the state attributes `open`, `value`,
`checked` and `selected`, which change only when the server's markup names
them. That includes the `width` and `height` a script measured onto a
`<canvas>`, and `popover`, `popovertarget` or `hidden` that an enhancement
script sets on a custom element opted in with `data-payload-morph`. Mark such
an element `data-payload-owned` so the morph leaves it alone, or render those
attributes on the server in the preview, so the markup the morph matches
already carries them.

A page whose DOM a framework router owns can hand the strategy that router's
own refresh with `registerRouteRefresh()`, or `<LivePreviewRouteRefresh>` from
`payload-live-preview/react` in Next.js. The strategy then calls it instead of
the GET and the morph, waits for the promise it returns, and re-applies the
revision on the committed markup; a refresh that returns no promise is reported
once, under `debug`, as `LP0810` (ADR 0028). The recipes are in
[nextjs.md](nextjs.md#client-navigation-and-route-refreshes),
[sveltekit.md](sveltekit.md#client-navigation-and-route-refreshes) and
[nuxt.md](nuxt.md#client-navigation-and-route-refreshes).

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
([docs/interop.md](interop.md)). The event follows every revision that carried a
change, whether or not a binding outside the islands was written — a page whose
bindings all sit inside islands still hears every edit
([docs/renderers.md](renderers.md#islands)). Patch boundaries, fragment boundaries and
hook islands coexist on one page.

## Revision discipline

One revision per admin message. A newer message aborts the previous
revision's fragment requests; a response that arrives late is discarded;
identical boundaries in one revision share a request; the client keeps at
most four requests in flight (`maxConcurrent` on `createFragmentStrategy()`).
An aborted request leaves that count as soon as its fetch settles, while the
browser and the server may still be finishing it, so a server can see more than
four for a moment. The endpoint answers an aborted request
`400 {"error":"request"}`, or `{"error":"body"}` when its body was not read
yet. The browser never reads that answer, but a server that logs status codes
shows those 400s beside the 200s while an editor types. Slow fragment A can never overwrite fast fragment B.
