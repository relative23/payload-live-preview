---
'payload-live-preview': minor
---

`LP0409`: the strict sanitizer now says what it removed.

`sanitizerPolicy` defaults to `'strict'` since 2.0; the 1.x default was `'compat'`, which let `id`, `name` and every `data-*` through. The difference only appears when a binding _writes_ markup, so an upgraded project loses its own hooks at the moment an editor types — in the preview, silently, with nothing in any log. Found by upgrading a real 1.8.1 site: a `data-*` attribute driving a CSS selector disappeared on the first write.

The removal stays — it is a security decision, and the migration guide has always documented it. What is new is that it is said, once per attribute name, with the reason that applies to that name: `id` and `name` because content that can name an element can shadow a global of that name; `data-payload-*` because a binding inside CMS content would let an editor aim a write at any element on the page; every other `data-*` with the two ways to keep it — `allowedDataAttributes`, or `sanitizerPolicy: 'compat'` for the 1.x behaviour.

Costs ~130 B gzip in every bundle that carries the runtime, the lean profile included. It buys the one 2.0 change an upgrading project could otherwise only discover by looking at the page.
