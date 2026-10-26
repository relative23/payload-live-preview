# Payload configuration

`payload-live-preview/plugin` configures Payload's own Live Preview panel. It
installs one root URL callback, enables the mapped collections and globals, and
can set the toolbar breakpoints. It is a Payload config plugin, not a browser
runtime plugin and not a frontend adapter.

The entry is structural: it imports neither Payload 2 nor Payload 3. The same
transform handles the callback arguments used by Payload 2.32.3
(`documentInfo`) and Payload 3.x (`collectionConfig` / `globalConfig`).
Payload 4 is still a pre-release and the direction of this package: support
becomes official with the stable 4.0 release. Payload 2 support ends with 3.0
of this package ([ADR 0007](architecture/0007-v2-defaults-and-renames-ledger.md#ledger),
entry 25); every 2.x release keeps it. The plugin was measured once
against 4.0.0-beta.4, outside CI, and the
[compatibility list](../README.md#compatibility) says what that run covered and
what it left out.

## Configure the panel

```ts
// payload.config.ts
import { buildConfig } from 'payload';
import { livePreview } from 'payload-live-preview/plugin';

export default buildConfig({
  plugins: [
    livePreview({
      // Your site's origin. In development: Astro 4321, Next.js and Nuxt 3000, SvelteKit 5173.
      baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
      collections: {
        posts: ({ data }) => `/blog/${String(data['slug'] ?? '')}`,
        services: ({ data, locale }) => `/${locale ?? 'en'}/services/${String(data['slug'] ?? '')}`,
      },
      globals: {
        homepage: '/',
      },
      breakpoints: [
        { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
        { label: 'Desktop', name: 'desktop', width: 1440, height: 900 },
      ],
    }),
  ],
});
```

Payload 2 imports `buildConfig` from `payload/config`; the plugin import and
options stay the same.

Every mapped key is added to `admin.livePreview.collections` or
`admin.livePreview.globals`. The installed callback uses the same mapping to
produce the iframe URL. A path resolver receives the current `data` and a
normalized locale code; a string is also a valid resolver.

The callback appends `?preview=true` by default. That parameter is preview
intent only. It does not authorize a draft read, runtime injection, a CSP
change or a fragment request.

## Merge rules

The plugin returns a new config without mutating its input. Its merge is narrow:

- Existing fields under `admin` and `admin.livePreview`, such as
  `openByDefault`, are preserved.
- Existing root `collections` and `globals` come first. Mapped slugs are added
  once, in mapping order.
- Omitting `breakpoints` preserves the existing root breakpoints. Supplying the
  option replaces that list with a shallow copy; `breakpoints: []` clears the
  configured list. Breakpoints are not merged by name.
- A mapped slug may be added before another config plugin adds that collection
  or global.
- Applying the same returned plugin function again is idempotent.

The plugin owns one root callback. It throws while Payload is building the
configuration if `admin.livePreview.url` already belongs to something else
when this transform runs. It also throws when a selected collection or global has its own
`admin.livePreview.url`, because Payload would let the entity callback override
the root callback. An unrelated entity callback is left alone.

Resolve a conflict explicitly: keep the existing callback, remove it in favor
of this plugin, or combine the routing rules in one callback. This transform
cannot inspect a URL written later in Payload's effective plugin execution
order. Make it run after any URL-writing plugin when it should detect that
conflict.

## Options

| Option         | Meaning                                                                                                            | Default     |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| `baseUrl`      | Frontend origin used for every generated iframe URL                                                                | required    |
| `collections`  | Collection slug to path string or `({ data, locale }) => string`                                                   | `{}`        |
| `globals`      | Global slug to path string or `({ data, locale }) => string`                                                       | `{}`        |
| `fallback`     | Path for an unmapped entity or a resolver that returns `''`                                                        | `'/'`       |
| `previewParam` | Query parameter added as `<name>=true`; keep a custom name in the adapter's `previewQueryParams`; `null` adds none | `'preview'` |
| `breakpoints`  | Payload toolbar breakpoints with number or CSS-string dimensions; supplied values replace the existing root list   | preserved   |

The default frontend adapters recognize query intent through `preview`,
`draft` and `livePreview`. Add a custom `previewParam` to the adapter's
`previewQueryParams` too. With `previewParam: null`, query-only intent sees no
marker; configure another intent signal or explicit delivery path. None of
these signals authorize a draft request.

Payload 3.92.0 gives a collection document its native Live Preview only after
the first save. On the create screen there is no preview toggle, no panel and no
frame, whether the collection's URL comes from this plugin's function or from a
fixed `admin.livePreview.url` string, and typing does not change that. After the
save the toggle appears and the frame loads the saved document: the URL the
plugin's function returns for a collection it maps (`/mapped/<id>` in the
fixture), the fixed string for one it does not. The editor's unsaved edits reach
the frame, and REST reads before and after show that the collection holds only
the save. The `create` target of the real-admin
suite (`tests/real-payload/surface-create.spec.ts`) measures all of this in
Chromium, Firefox and WebKit. In Payload's source (`handleLivePreview` in
`@payloadcms/ui`, read in 3.92.0) a function-valued URL is evaluated only for a
saved document; the suite does not test that part.

The real-admin fixture runs the Astro (static, hybrid and middleware), Next.js,
SvelteKit, Nuxt and plain HTML examples, a React hook page and a Vue composable
page against a real Payload 3.92.0 admin and proves unsaved edits on an existing
global. CI runs the static Astro target in Chromium and every other target in
Chromium, Firefox and WebKit, and runs the Next.js session and hook targets once
more in Chromium with Payload's `csrf` list set
([authorization.md](authorization.md#payload-session));
`PLP_REAL_PAYLOAD_BROWSERS` selects the engines locally.
The Next.js, SvelteKit, Nuxt and Astro middleware previews authorize the
editor's real session (`payload-session`); the hook and the composable populate
a relationship through a credentialed request to the admin's REST API from the
preview's own origin. Those surface suites cover an existing global; the `create`
target covers collection documents. Payload posts the document when its form
state changes, not when the frame loads, so a bare reload of the preview frame
shows the saved document until the next change in the form.

The config plugin's path resolvers return strings. For a document that should
have no iframe, use the lower-level `buildLivePreviewUrl()` callback directly:
its nullable overload accepts a resolver or fallback of `null`.

```ts
import { buildLivePreviewUrl } from 'payload-live-preview/payload';

const url = buildLivePreviewUrl({
  baseUrl: process.env.FRONTEND_URL!,
  collections: {
    posts: ({ data }) => (data['slug'] ? `/blog/${String(data['slug'])}` : null),
  },
  fallback: null,
});
```

Payload 3's published callback type accepts this nullable result. Payload
2.32.3's published `LivePreviewConfig['url']` function type accepts only a
string or `Promise<string>`; use the non-null overload and a string fallback in
a typed Payload 2 config. The config plugin stays inside that common,
string-only result contract.

The `/payload` entry remains the manual building block. Use it when another
plugin already owns the surrounding config, when nullable routes matter, or
when an application deliberately composes a more involved callback.

## Authorization stays outside the config plugin

`livePreview()` accepts no signing secret, token option, session verifier or
frontend authorization hook. It never appends `previewToken`. Configure the
site's request-time adapter with `authorizePreview` and one of the strategies
in [authorization.md](authorization.md).

Prefer `payload-session` where the editor cookie reaches the preview site. A
manual signed-token URL callback is a Payload 3 server-side integration only;
do not put a signing secret in a Payload 2 config callback, which runs in the
admin browser. The same URL token may also be needed by page entry, fragment
requests and reloads, so a one-use replay store is not a complete lifecycle by
itself. That manual boundary is described with the token recipe in
[authorization.md](authorization.md#signed-token).

The separation is deliberate: URL selection is shared across Payload 2 and 3,
while credentials and draft access belong to a server that can keep secrets.
See [ADR 0017](architecture/0017-structural-payload-config-plugin.md).
