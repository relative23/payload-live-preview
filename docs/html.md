# Plain HTML

No framework and no server: the runtime is a string, so a build script writes it into static pages. The same call serves any templating setup that produces HTML on the server.

Environment name used below: `PUBLIC_PAYLOAD_ADMIN_ORIGIN` is the admin origin the browser sees.

## Install

```bash
npm install payload-live-preview
```

## Generate the script

```ts
// build.ts — runs at build time, never in the browser
import { generateInlineScript, wrapWithScriptTag } from 'payload-live-preview';

const script = generateInlineScript({
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
  // Payload 3.x: re-fetch the populated document; mergeDepth is required with serverURL.
  serverURL: process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!,
  mergeDepth: 1,
});

const tag = wrapWithScriptTag(script); // `<script>…</script>`; pass { nonce } for a CSP nonce
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">${tag}</head><body>…</body></html>`;
```

The tag goes into `<head>`. The script stays inert outside the admin's preview iframe and costs about 29 KB gzip on every page that carries it. `generateInlineScript()` returns the script body and accepts the runtime options ([options.md](options.md)); `wrapWithScriptTag()` adds the tag and an optional `nonce`.

## Annotate the markup

```html
<h1 data-payload-field="title">Hello</h1>
<p data-payload-field="subtitle"></p>
<img data-payload-field="hero" data-payload-type="image" src="/hero.jpg" alt="" />
<ul data-payload-field="tags" data-payload-array-template="<li>{{value}}</li>"></ul>
```

Render an element even when its field is empty: the runtime patches elements that exist, and an edit to an initially empty field needs somewhere to land. Rich text is detected from the value shape. Every attribute, the field types and the owner marker for pages with several documents: [bindings.md](bindings.md).

## Authorization

A static file has no request to authorize, so nothing in it can be private: the script and every `data-payload-*` attribute ship to every visitor, and `allowedOrigins` is the only check — it decides which admin origin may post updates into the page. Draft content and gated delivery need a server; `authorizePreviewRequest()` from `payload-live-preview/server` and the framework adapters do that ([authorization.md](authorization.md)). Serve preview pages with a `frame-ancestors` policy that admits the admin origin and without `X-Frame-Options: DENY` ([deployment.md](deployment.md)).

## Bundled applications

An application with its own bundler starts the client instead of embedding the script. `initLivePreview()` returns the client inside a preview context and `null` elsewhere; every single-page framework reduces to this call:

```ts
import { initLivePreview } from 'payload-live-preview/client';

const client = initLivePreview({ allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN] });
```

`client.events`, plugins and custom renderers are in [renderers.md](renderers.md).

## Body swap caveat

The runtime binds what is in the document and watches it. Elements added later are bound after the mutation debounce, and a router that replaces `document.body` on navigation is followed: observers and bindings move to the new body. Values already patched into the old markup are gone until the next update arrives, and a script of your own that rewrites a bound element's content overwrites the patch the same way.

## Examples

- [`examples/pure-html`](../examples/pure-html) — static HTML carrying the inline runtime from `generateInlineScript()`.
- [`examples/vanilla-client`](../examples/vanilla-client) — a bundled page calling `initLivePreview()` from `payload-live-preview/client`.

## When something does not update

`__livePreview.inspect()` in the preview iframe's console (or `client.inspect()` on a client you started) names the cause in most cases; the readings, `pll doctor` and every diagnostic code are in [troubleshooting.md](troubleshooting.md).
