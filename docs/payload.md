# Payload configuration

`payload-live-preview/plugin` configures Payload's own Live Preview panel. It
installs one root URL callback, enables the mapped collections and globals, and
can set the toolbar breakpoints. It is a Payload config plugin, not a browser
runtime plugin and not a frontend adapter.

The entry is structural: it imports neither Payload 2 nor Payload 3. The same
transform handles the callback arguments used by Payload 2.32.3
(`documentInfo`) and Payload 3.x (`collectionConfig` / `globalConfig`).

## Configure the panel

```ts
// payload.config.ts
import { buildConfig } from 'payload';
import { livePreview } from 'payload-live-preview/plugin';

export default buildConfig({
  plugins: [
    livePreview({
      baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:4321',
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

Payload 3.89 does not evaluate a function-valued Live Preview URL for a
collection document in its initial create state. This plugin uses one function
to route the mapped entities, so a brand-new collection document has no iframe
until its first save. When the create screen itself must have a preview, omit
that collection from the plugin mapping and configure its entity-level
`admin.livePreview.url` as a string. The real-admin fixture proves unsaved edits
on an existing global; it does not claim this create-state case.

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
