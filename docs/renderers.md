# Renderers, events and plugins

What a renderer receives, how it is chosen, what it writes, which events the
client emits, and what a plugin owns.

## What a renderer receives: raw, populated, transformed

Every update passes through the same stages before a renderer sees a value:

1. **Raw.** The admin's `postMessage` carries the form state as typed. In
   Payload 3.x relationship and upload fields arrive as bare ids.
2. **Populated.** With `serverURL` (or `definePreview().runtimeOptions`)
   configured, the runtime merges the raw state with a REST read at
   `mergeDepth`, so relations become documents. Without `serverURL` this
   stage is skipped and renderers see the raw ids.
3. **Transformed.** Plugin transforms registered for the field run in
   registration order, synchronously, and their result is what the renderer
   gets. A transform that throws is logged (`LP0602`) and its input passes
   through unchanged.

Renderers therefore receive the populated, transformed value. `context`
carries `allFields` (the whole transformed update), `locale`, the field
`schema` when the admin sent one, and `renderRichText` when the client was
configured with one.

## Choosing a renderer

Resolution order for an element:

1. `resolveRenderer(fieldType, target)` on `LivePreviewClient` — an explicit
   resolver that sees the element and its attributes. Return a renderer, or
   `undefined` to fall through.
2. The registry: renderers registered by plugins (`ctx.registerFieldRenderer`)
   layered over the built-ins; the last registration for a key wins, and
   unregistering restores the previous layer.
3. The built-in renderer for the resolved type.

The type itself comes from `data-payload-type` when set, else from the
admin's field schema, else from element heuristics (`<img>` → `image`,
`<a>` → `url`, `data-payload-richtext` → `richText`, …); the full list is in
[docs/bindings.md](bindings.md).

### Registering a renderer

A plugin registers renderers in `init`. Registering under a built-in name
layers over that built-in for this client:

```ts
import { LivePreviewClient } from 'payload-live-preview';

const client = new LivePreviewClient({ allowedOrigins: ['https://admin.example.com'] });
await client.use({
  name: 'currency',
  init: (ctx) => {
    ctx.registerFieldRenderer({
      name: 'text',
      render: (target, value) => {
        target.element.textContent = new Intl.NumberFormat('de-AT', {
          style: 'currency',
          currency: 'EUR',
        }).format(Number(value));
      },
    });
  },
});
```

### Custom renderer keys

A project renderer registers under a **namespaced** key —
`data-payload-type="acme:money"` selects the renderer named `acme:money`.
The namespace is what keeps built-in safety intact: an un-namespaced unknown
type such as `richtext` (lowercase) is treated as what it is, a typo, and the
element falls back to the heuristics. Keys match
`^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`.

```ts
client.use({
  name: 'acme-renderers',
  compat: { runtime: '>=2.0.0' },
  init(ctx) {
    ctx.registerFieldRenderer({
      name: 'acme:money',
      render(target, value) {
        target.element.textContent = formatMoney(value);
      },
    });
  },
});
```

## Value semantics: one contract for every renderer

Every built-in renderer answers the same three questions the same way. The
rule that matters most: **a clear is a write.** An emptied field counts in
`updatedCount` and fires `afterUpdate`, because "the value went away" is a
change the page must show, not a message to ignore.

| Value                                                                       | Every renderer does                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `null`, `undefined`, `''`                                                   | Clears the element and counts as a write                                     |
| An unsafe URL (fails `isSafeUrl`)                                           | Clears the URL attribute, warns `LP0401` once per element, counts as a write |
| A value with no usable URL (media object without `url`, a bare relation id) | Leaves the element untouched and counts as **no** write                      |

What "clears" means per renderer:

| Renderer                                                   | Cleared                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `url`, `email`                                             | `removeAttribute('href')`, text emptied; on an input, `value = ''` |
| `relationship`                                             | `removeAttribute('href')`, text emptied                            |
| `image`, `upload` on `<img>`                               | `src`, `srcset` and `sizes` all removed                            |
| `image` on any other element                               | `background-image` emptied                                         |
| `upload` on `<a>` or a block                               | `href` removed, text emptied                                       |
| `richText`, `html`, `array`                                | `innerHTML` emptied                                                |
| `structural-array`                                         | Every keyed item removed                                           |
| `text`, `textarea`, `number`, `date`, `select`, `checkbox` | The control reset (`value = ''`, `checked = false`)                |

### Responsive images

Setting `src` alone leaves a server-rendered `srcset` winning, so the
`<img>` never changes. `image` and `upload` therefore rebuild the whole set:
each `PayloadMedia.sizes` entry with a `url` and a numeric `width` becomes a
candidate (checked with `isSafeUrl`, commas and spaces percent-encoded), and
the base `url`/`width` is appended. Media with no usable `sizes` removes
`srcset` **and** `sizes`. An author-written `sizes` layout hint survives a
rebuild — it describes the layout, not the media.

### Email

`email` is its own renderer, not an alias of `url`. A value with no scheme
that contains `@` becomes `mailto:jane@example.com`; a value that already
carries a scheme is used as written.

## Class hooks the renderers emit

The sanitizer strips `data-*` and `style` under both policies, so the Lexical
renderers express everything through classes. Nothing is JSON-serialized into
an attribute. Style these, or replace the node with `registerLexicalNode` /
`registerBlockRenderer` from `payload-live-preview/lexical`.

| Class                                                               | Emitted by                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `lp-block`, `lp-block--<slug>`                                      | A `block` node with no registered renderer (`<div>`)                                      |
| `lp-inline-block`, `lp-inline-block--<slug>`                        | An `inlineBlock` node with no registered renderer (`<span>`)                              |
| `lp-relation`, `lp-relation--<collection>`                          | A `relationship` node (`<a>` when the populated document has a safe `url`, else `<span>`) |
| `lp-align-left\|center\|right\|justify\|start\|end`                 | Any block node with an alignment                                                          |
| `lp-indent-<n>`                                                     | Any block node with `indent > 0`                                                          |
| `lp-block-callout`, `lp-block-callout--<importance>`                | `registerDefaultBlocks()`'s callout                                                       |
| `lp-block-image`, `lp-block-video`, `lp-block-code`, `lp-block-cta` | The other default blocks                                                                  |
| `language-<lang>`                                                   | A `code` node, on the inner `<code>`                                                      |

`<slug>`, `<collection>` and `<lang>` are reduced to `[a-z0-9_-]`: every
other character becomes `-`, so a slug can never escape the class attribute.

Alignment and indent are classes, not inline CSS — the sanitizer removes
`style` under both policies, so a `style="text-align:center"` would never
reach the page.

### The sanitizer adds `target="_blank"` itself

An anchor whose `href` is an external `http(s)` URL leaves the sanitizer with
`rel="noopener noreferrer"`, and with `target="_blank"` unless the markup
already set a `target`. This applies to every sanitized write — a CMS link
inside rich text, a plugin renderer's HTML, an array template — so a link
that must open in the same tab needs an explicit `target="_self"`.

## `renderRichText`: one renderer for SSR and preview

A site that renders Lexical itself — custom nodes, its own markup — wants the
preview to produce exactly that markup, not the package's default. Pass the
renderer to the client:

```ts
import { lexicalToHtml, sanitizeHtml, type LexicalRoot } from 'payload-live-preview';
import { registerLexicalNode } from 'payload-live-preview/lexical';

registerLexicalNode(
  'callout',
  (node, ctx) => `<aside class="callout">${ctx.renderChildren(node.children ?? [])}</aside>`,
);
export const renderRichText = (value: unknown) => lexicalToHtml(value as LexicalRoot);

// server: sanitizeHtml(renderRichText(doc))
// client: new LivePreviewClient({ renderRichText })
```

The runtime passes the renderer's output through the sanitizer. Sanitize the
server output with the same `sanitizeHtml()` and the two are byte-equal. The
inline runtime (adapters) cannot carry a function; `renderRichText` is a
`LivePreviewClient` / `initLivePreview` option.

### Custom Lexical nodes and the sanitizer

`registerLexicalNode(type, render)` adds a node renderer to `lexicalToHtml`.
In the browser the runtime sanitizes the whole rendered document, so a
custom node cannot introduce a script or an event handler however it is
written. On the server `lexicalToHtml` sanitizes when a sanitizer document
was set (`setSanitizerDocument()` with linkedom or jsdom); **without one it
returns the HTML as rendered and warns once**, because silently unsanitized
output is the worse failure. The built-in nodes escape their own output;
custom nodes are responsible for theirs — see [docs/security.md](security.md).
Pass `{ sanitize: false }` when the caller sanitizes downstream itself; that
opts out of the warning too.

The built-in nodes read the shapes `@payloadcms/richtext-lexical` actually
serializes, not vanilla Lexical's: a link is
`{ type: 'link', fields: { linkType, url, newTab, doc } }` (an `internal`
link needs `doc.value` populated to have a URL at all — a bare id renders the
link text only), and `block`, `inlineBlock`, `table`, `tablerow` and
`tablecell` all have renderers, so a table stays a table instead of
collapsing into its text.

## Events

```ts
const client = new LivePreviewClient({ allowedOrigins: ['https://admin.example.com'] });

client.events.on('connect', (e) => console.log('connected to', e.origin));
client.events.on('beforeUpdate', (e) => {
  if (frozen) e.cancel();
});
client.events.on('documentSave', () => location.reload());
```

Events: `init` · `connect` · `disconnect` · `beforeUpdate` · `afterUpdate` ·
`elementUpdate` · `cacheRefresh` · `fragmentRender` · `documentSave` ·
`relationshipUpdate` · `error` · `destroy`.

`beforeUpdate`, `afterUpdate` and `elementUpdate` carry `revision`,
`receivedAt` (when the runtime accepted the message, Unix ms) and `source`
(`'patch'`, `'fragment'` or `'route'`: the strategy that produced the
update). `fragmentRender` fires per boundary and revision with `status`
`'rendered'` or `'failed'` and the diagnostic `code`. `relationshipUpdate`
fires when an update carries `externallyUpdatedRelationship` (a related
document edited in an admin drawer); that update re-renders every bound field
even under `skipUnchanged`, because populated values may have changed while
the form values did not. `error` carries a stable `code`, so a handler can
branch on `DIAGNOSTIC_CODES` without parsing the message.

## Transforms are synchronous — by decision

`registerTransform(field, fn)` must return a value, not a promise; a
thenable is a `TypeError` (`LP0602`) and the input passes through. The
reason is ordering: a transform runs inside the flush for one revision, and
an awaited transform would let a newer revision overtake it. Async work
belongs in the revision-aware pre-render hook, `beforeUpdate` — it is
awaited, carries `revision` and `receivedAt`, and `cancel()` drops exactly
that revision:

```ts
client.events.on('beforeUpdate', async (e) => {
  const extra = await fetchExtra(e.data.fields.id, { signal });
  if (stale(e.revision)) e.cancel();
  else cache.set(e.revision, extra); // read it from a synchronous transform
});
```

Synchronous transforms see the merged field value and run in registration
order while each revision-bound binding entry is prepared, immediately before
that entry is scheduled. The transformed value is fixed in the entry and later
passes through the normal attribute or renderer dispatch. A thrown error or a
thenable result emits a lifecycle `error` and keeps the original merged value
as the fallback, which still passes through the normal security checks.

## Plugin ownership

A plugin owns what it registers, and only for as long as it is registered:

- `init(ctx)` registers transforms, renderers, event subscriptions
  (`ctx.events.on/once`) and cleanups (`ctx.registerCleanup`). Every
  registration is scoped; `client.unuse(name)` — or a failed `init` —
  releases all of them, in reverse order, without touching another plugin or
  the built-in renderers. Registering the plugin again starts with a fresh
  scope.
- **Staging.** Resources stay staged until `init()` succeeds; a failed
  `init()` rolls them back without exposing a partial registration.
- **Order and precedence.** Transforms for a field run in registration
  order across plugins. Renderers layer: the last registration wins,
  unregistering restores the previous layer.
- **Duplicates.** A second plugin with a registered name is ignored and
  logged; the first stays.
- **Async destroy.** `destroy()` may return a promise; `unuse()` resolves
  after it, and the plugin's registrations are already released when it runs.
- **Compatibility.** `compat: { runtime: '>=2.0.0', protocol: 4 }` is checked
  at registration; a plugin that does not fit is refused, logged, and
  reported on the client's `error` event with `code: 'LP0103'` and
  `context: 'plugin'`, so a refusal is visible without reading the console.
  Write an open range: a caret range pinned to an older major (`^1.2.0`) is
  refused by this runtime, which is almost never what the author meant.
- **Observable.** `client.inspect().plugins` lists each plugin with its
  state and live registrations by kind, so "teardown is complete" is a
  snapshot fact.

The contract is recorded in
[ADR 0005 — Plugin resource ownership and transform ordering](architecture/0005-plugin-resource-ownership.md).

### Built-in plugins

| Plugin                             | Effect                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `highlightPlugin`                  | Flashes an outline on updated elements (respects reduced motion).                                |
| `debugPlugin`                      | Logs every lifecycle event to the console.                                                       |
| `createAnalyticsPlugin()`          | Collects update statistics, exposed via `getStats()`.                                            |
| `documentSavePlugin({ strategy })` | Reacts to admin saves: `'silent'` · `'reload'` (scroll-preserving) · `'revalidate'` · `'fetch'`. |

### `documentSave`: the `revalidate` endpoint authorizes itself

The `'revalidate'` strategy POSTs `{ source: 'payload-live-preview' }` to
`revalidateUrl` (default `/api/revalidate`) as a plain `fetch` from the
preview page. Cookies travel with it and **there is no CSRF token**; a bearer
secret in `revalidateHeaders` would sit in page JavaScript where any visitor
can read it. The endpoint must authorize on its own — an admin session
cookie, a same-origin check, or both — and must be safe to call repeatedly
from a browser that is already framed by the CMS.

## Islands

A hydrated framework island — `astro-island`, or any element marked
`data-payload-island` — owns its subtree. The runtime does not patch a
binding inside it, and the keyed morph never enters it
([ADR 0008 — Keyed morph: what it keeps, what it never crosses](architecture/0008-keyed-morph-ownership.md)).
Instead, every applied update is dispatched on each island root as a
`payload-live-preview:update` DOM event whose `detail` is
`{ fields, revision, receivedAt, locale }`:

```ts
// inside a React island
useEffect(() => {
  const root = ref.current?.closest('[data-payload-island]');
  const onUpdate = (e: Event) => setFields((e as CustomEvent<IslandUpdateDetail>).detail.fields);
  root?.addEventListener('payload-live-preview:update', onUpdate);
  return () => root?.removeEventListener('payload-live-preview:update', onUpdate);
}, []);
```

An island that uses Payload's official `useLivePreview` hook needs nothing
from the bridge: the admin's `postMessage` reaches the window the island
lives in, and this runtime keeps its hands off the island's DOM. An island
that wants the runtime's patching after all opts in with
`data-payload-island="patch"` and receives no event.
