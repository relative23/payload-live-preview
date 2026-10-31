---
'payload-live-preview': minor
---

The config plugin from `payload-live-preview/plugin` takes `order`, and its path resolvers and `fallback` may be `null`. `order` sets the plugin's position in Payload 3 and 4, which sort plugins by it; without the option the plugin has no `order`, as before, and Payload 2 ignores it. `null` means a document has no preview: in Payload 3 and 4 a saved document then has no toggle and no frame. Keep to strings on Payload 2, whose callback type accepts no `null`. The returned plugin now carries `slug: 'payload-live-preview'`, which other plugins can look up in `config.plugins`.
