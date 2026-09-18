---
'payload-live-preview': patch
---

`hasPreviewIntent()` reads the last value of a repeated query parameter, as a Next.js `has` rule does. `?preview=true&preview=0` was intent for the adapters and the runtime but not for the `Cache-Control: private, no-store` rule `withLivePreview()` installs, so such a page was injected yet cacheable; the two readings now agree.
