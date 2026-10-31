---
'payload-live-preview': minor
---

A project on Payload 2 now hears in development that 3.0 ends Payload 2 support. The runtime and `useLivePreviewDocument()` warn once when the first update with `fieldSchemaJSON` arrives, which only Payload 2 sends. Where `NODE_ENV` is readable the warning follows it; elsewhere, such as an inline script, it appears on `localhost` and `127.0.0.1`. The lean inline profile leaves it out. Behaviour on Payload 2 does not change, and every 2.x release keeps supporting it.
