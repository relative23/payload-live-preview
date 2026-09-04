# Renderers, transforms and plugins

What a renderer receives, how it is chosen, what it writes, and what a plugin
owns.

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
admin's field schema, else from tag heuristics (`<img>` → image, `<a>` → url,
`data-payload-richtext` → richText, …).

### Custom renderer keys

A project renderer registers under a **namespaced** key —
`data-payload-type="acme:money"` selects the renderer named `acme:money`.
The namespace is what keeps built-in safety intact: an un-namespaced unknown
type such as `richtext` (lowercase) is treated as what it is, a typo, and the
element falls back to the heuristics as it always has. Keys match
`^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`.

```ts
client.use({
  name: 'acme-renderers',
  compat: { runtime: '>=1.2.0' },
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

`tests/unit/field-types/value-semantics.test.ts` pins the table renderer by
renderer, under an explicit sanitizer policy.

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

The 2.0 sanitizer strips `data-*` and `style` under both policies, so the
Lexical renderers express everything through classes. Nothing is
JSON-serialised into an attribute. Style these, or replace the node with
`registerLexicalNode` / `registerBlockRenderer`.

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
reach the page. `resolveAlignment(node)` and `resolveIndent(node)` stay
public for a custom node renderer that wants the same values.

### The sanitizer adds `target="_blank"` itself

An anchor whose `href` is an external `http(s)` URL leaves the sanitizer with
`rel="noopener noreferrer"`, and with `target="_blank"` unless the markup
already set a `target`. This applies to every sanitised write — a CMS link
inside rich text, a plugin renderer's HTML, an array template — so a link
that must open in the same tab needs an explicit `target="_self"`.

## `renderRichText`: one renderer for SSR and preview

A site that renders Lexical itself — custom nodes, its own markup — wants the
preview to produce exactly that markup, not the package's default. Pass the
renderer to the client:

```ts
import { lexicalToHtml, registerLexicalNode, sanitizeHtml } from 'payload-live-preview';

registerLexicalNode(
  'callout',
  (node, ctx) => `<aside class="callout">${ctx.renderChildren(node.children ?? [])}</aside>`,
);
export const renderRichText = (value: unknown) => lexicalToHtml(value as LexicalRoot);

// server: sanitizeHtml(renderRichText(doc))
// client: new LivePreviewClient({ renderRichText })
```

The runtime passes the renderer's output through the sanitizer. Sanitize the
server output with the same `sanitizeHtml()` and the two are byte-equal —
`tests/unit/core/renderer-api.test.ts` pins that equivalence for one
document with a custom node. The inline runtime (adapters) cannot carry a
function; `renderRichText` is a `LivePreviewClient` / `initLivePreview`
option.

### Custom Lexical nodes and the sanitizer

`registerLexicalNode(type, render)` adds a node renderer to `lexicalToHtml`.
In the browser the runtime sanitizes the whole rendered document, so a
custom node cannot introduce a script or an event handler however it is
written. On the server `lexicalToHtml` sanitizes when a sanitizer document
was set (`setSanitizerDocument()` with linkedom or jsdom); **without one it
returns the HTML as rendered and warns once**, because silently unsanitised
output is the worse failure. The built-in nodes escape their own output;
custom nodes are responsible for theirs — see [security.md](security.md) §3.
Pass `{ sanitize: false }` when the caller sanitizes downstream itself; that
opts out of the warning too.

The built-in nodes read the shapes `@payloadcms/richtext-lexical` actually
serialises, not vanilla Lexical's: a link is
`{ type: 'link', fields: { linkType, url, newTab, doc } }` (an `internal`
link needs `doc.value` populated to have a URL at all — a bare id renders the
link text only), and `block`, `inlineBlock`, `table`, `tablerow` and
`tablecell` all have renderers, so a table stays a table instead of
collapsing into its text.

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

## Plugin ownership

A plugin owns what it registers, and only for as long as it is registered:

- `init(ctx)` registers transforms, renderers, event subscriptions
  (`ctx.events.on/once`) and cleanups (`ctx.registerCleanup`). Every
  registration is scoped; `client.unuse(name)` — or a failed `init` —
  releases all of them, in reverse order.
- **Order and precedence.** Transforms for a field run in registration
  order across plugins. Renderers layer: the last registration wins,
  unregistering restores the previous layer.
- **Duplicates.** A second plugin with a registered name is ignored and
  logged; the first stays.
- **Rollback.** If `init` throws, everything it registered is released and
  the plugin is not listed.
- **Async destroy.** `destroy()` may return a promise; `unuse()` resolves
  after it, and the plugin's registrations are already released when it runs.
- **Compatibility.** `compat: { runtime: '>=1.2.0', protocol: 4 }` is checked
  at registration; a plugin that does not fit is refused, logged, and
  reported on the client's `error` event with `code: 'LP0103'` and
  `context: 'plugin'`, so a refusal is visible without reading the console.
  Write an open range: a caret range pinned to a 1.x version (`^1.2.0`) is
  refused by the 2.0 runtime, which is almost never what the author meant.
- **Observable.** `client.inspect().plugins` lists each plugin with its
  state and live registrations by kind, so "teardown is complete" is a
  snapshot fact. `tests/unit/plugins/ownership-contract.test.ts` pins that
  300 register/unregister cycles return every count to its baseline.

### `documentSave`: the `revalidate` endpoint authorises itself

The `'revalidate'` strategy POSTs `{ source: 'payload-live-preview' }` to
`revalidateUrl` (default `/api/revalidate`) as a plain `fetch` from the
preview page. Cookies travel with it and **there is no CSRF token**; a bearer
secret in `revalidateHeaders` would sit in page JavaScript where any visitor
can read it. The endpoint must authorise on its own — an admin session
cookie, a same-origin check, or both — and must be safe to call repeatedly
from a browser that is already framed by the CMS.

## Islands

A hydrated framework island — `astro-island`, or any element marked
`data-payload-island` — owns its subtree. The runtime does not patch a
binding inside it, and the keyed morph never enters it (ADR 0008 §4).
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
`tests/e2e/specs/island-bridge.spec.ts` proves the split in three browsers.
