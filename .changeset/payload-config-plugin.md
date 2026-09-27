---
'payload-live-preview': minor
---

Add `payload-live-preview/plugin`, a structural Payload 2.32.3 and 3.x config plugin. It installs one shared live-preview URL callback, merges mapped collections and globals into the root lists, preserves or explicitly replaces root breakpoints, and refuses competing URL callbacks already present when it runs. Authentication stays at the server boundary; the plugin accepts no signing secret or token option.
