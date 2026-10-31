---
'payload-live-preview': minor
---

`internalLinkPattern` gives a Lexical internal link the site's route, such as `/{locale}/{slug}/`, on the adapters, `LivePreviewClient`, `generateInlineScript()` and `lexicalToHtml()`. The live write made every such link `/<slug>`, without a locale prefix or a trailing slash and with no way to change it from an adapter, so it pointed somewhere else than the server's own link. A document's own `url` still wins, and with no pattern, or a placeholder that has no value, the link stays `/<slug>`.
