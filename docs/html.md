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

The tag goes into `<head>`. The script stays inert outside the admin's preview iframe and costs about 42 KB gzip on every page that carries it, 33 KB with the lean artifact (`runtime: LEAN_RUNTIME`, [options.md](options.md)). `generateInlineScript()` returns the script body and accepts the runtime options ([options.md](options.md)); `wrapWithScriptTag()` adds the tag and an optional `nonce`.

## Annotate the markup

```html
<h1 data-payload-field="title">Hello</h1>
<p data-payload-field="subtitle"></p>
<img data-payload-field="hero" data-payload-type="image" src="/hero.jpg" alt="" />
<ul data-payload-field="tags" data-payload-array-template="<li>{{value}}</li>"></ul>
```

Render an element even when its field is empty: the runtime patches elements that exist, and an edit to an initially empty field needs somewhere to land. Rich text is detected from the value shape, in the lean artifact too. Every attribute, the field types and the owner marker for pages with several documents: [bindings.md](bindings.md).

## Content Security Policy

A static host has no request to derive a nonce from, but the script is fixed once it is built, so its hash can stand in a fixed header. Hash exactly what `generateInlineScript()` returned, the text between the tags, and build it again with every version or option change:

```ts
import { createHash } from 'node:crypto';

const hash = createHash('sha256').update(script).digest('base64');
// Content-Security-Policy: script-src 'sha256-${hash}'; frame-ancestors <admin origin>
```

Under that policy the runtime runs, and under a wrong hash the browser blocks it. A host that can set a nonce per request passes it as `wrapWithScriptTag(script, { nonce })` instead.

## Authorization

A static file has no request to authorize, so nothing in it can be private: the script and every `data-payload-*` attribute ship to every visitor, and `allowedOrigins` is the only check — it decides which admin origin may post updates into the page. Draft content and gated delivery need a server; `authorizePreviewRequest()` from `payload-live-preview/server` and the framework adapters do that ([authorization.md](authorization.md)). A static site that needs them adds a small service on the same origin for the preview route and keeps the published pages static; nothing in the static setup starts one for you.

Only an origin in `allowedOrigins` can drive the page: a message from any other parent window is dropped, and the `ready` handshake is addressed to the allowed origins, so a foreign parent receives nothing. One exception belongs to development: a page served from `localhost` or `127.0.0.1` also trusts every local origin, and in development `ready` goes to common local ports as well ([security.md](security.md)). `disableLocalhostMatching: true` turns that off. Serve preview pages with a `frame-ancestors` policy that admits the admin origin and without `X-Frame-Options: DENY` ([deployment.md](deployment.md)).

## Bundled applications

An application with its own bundler starts the client instead of embedding the script. `initLivePreview()` returns the client inside a preview context and `null` elsewhere; every single-page framework reduces to this call:

```ts
import { initLivePreview } from 'payload-live-preview/client';

const client = initLivePreview({ allowedOrigins: [import.meta.env.VITE_PAYLOAD_ADMIN_ORIGIN] });
```

That name uses Vite's default `VITE_` public prefix. The value is an origin the
browser must know, not a credential; keep tokens and secrets out of public
environment variables. With another bundler, use its equivalent public setting.

`client.events`, plugins and custom renderers are in [renderers.md](renderers.md).

## Body swap caveat

The runtime binds what is in the document and watches it. Elements added later are bound after the mutation debounce, and a router that replaces `document.body` on navigation is followed: observers and bindings move to the new body. Values already patched into the old markup are gone until the next update arrives, and a script of your own that rewrites a bound element's content overwrites the patch the same way.

## Examples

- [`examples/pure-html`](../examples/pure-html) — static HTML carrying the inline runtime from `generateInlineScript()`.
- [`examples/vanilla-client`](../examples/vanilla-client) — a bundled page calling `initLivePreview()` from `payload-live-preview/client`.

## When something does not update

`__livePreview.inspect()` in the preview iframe's console (or `client.inspect()` on a client you started) names the cause in most cases; the readings, `pll doctor` and every diagnostic code are in [troubleshooting.md](troubleshooting.md).
