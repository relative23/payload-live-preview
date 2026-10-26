---
'payload-live-preview': minor
---

`pll doctor` reads the options of a page that starts `LivePreviewClient` itself. Such a page has no inline script to read, so `--v2` reported the configuration as unreadable, and `LP0705` judged the page against the default visibility gate even when it had raised the threshold. The doctor now also reads a `<script type="application/json" id="__LIVE_PREVIEW_CONFIG__">` element whose object names the options as the client takes them. An option left out is read as the client's 2.x default unless the object sets `defaults: 'v1'`. The inline script still wins when a page carries both.
