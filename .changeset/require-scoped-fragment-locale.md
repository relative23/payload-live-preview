---
'payload-live-preview': patch
---

Fragment endpoints now refuse a request that omits its locale when the authorization is scoped to one. An omitted locale no longer acts as a wildcard; matching and unscoped requests keep their existing behavior.
