---
'payload-live-preview': patch
---

The draft read of `definePreview()` now asks for `redirect: 'manual'` instead of `redirect: 'error'`, as the `payload-session` check does since this release. Cloudflare's workerd rejects `'error'` with a TypeError before sending, so every draft read there failed as `network`. A redirect is still never followed: it comes back as its own 3xx answer and fails the read as `http` with that status, where it used to fail as `network`. `PreviewFetchFunction` passes `redirect: 'manual'` in its `init`, so a custom `fetch` sees the mode. `cache: 'no-store'` stays; workerd accepts it from compatibility date 2024-11-11.
