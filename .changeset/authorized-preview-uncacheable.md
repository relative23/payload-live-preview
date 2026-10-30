---
'payload-live-preview': patch
---

An authorized preview is sent with `Cache-Control: private, no-store` and `Vary: Cookie` even when the adapter injects nothing and manages no CSP. The Astro, Next.js, SvelteKit and Nuxt adapters marked a response private only when they injected the runtime or merged the CSP, so with `autoInject: false` and `manageCsp: false` an authorized response kept the application's cache headers, although its page may render drafts with the verdict's `payloadHeaders`. A refused request and a request without preview intent still keep the application's headers.
