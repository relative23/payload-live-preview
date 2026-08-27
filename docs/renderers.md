# Renderers, transforms and plugins

What a renderer receives, how it is chosen, and what a plugin owns. This is
the extension surface as of 1.2.0; the roadmap calls it the point where
customisation stops being a convention and becomes a contract.

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
  compat: { runtime: '^1.2.0' },
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
was set (`setSanitizerDocument()` with linkedom or jsdom); without one the
built-in nodes escape their own output and custom nodes are responsible for
theirs — see [security.md](security.md) §3.

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
- **Compatibility.** `compat: { runtime: '^1.2.0', protocol: 4 }` is checked
  at registration; a plugin that does not fit is refused with a log line
  naming both sides.
- **Observable.** `client.inspect().plugins` lists each plugin with its
  state and live registrations by kind, so "teardown is complete" is a
  snapshot fact. `tests/unit/plugins/ownership-contract.test.ts` pins that
  300 register/unregister cycles return every count to its baseline.
