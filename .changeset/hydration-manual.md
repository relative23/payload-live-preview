---
'payload-live-preview': minor
---

A page can say when it has hydrated. `hydration: 'manual'`, on the adapters and `generateInlineScript()`, holds the runtime's first write until the page calls `markHydrated()` from `payload-live-preview`, so the write lands on markup the framework keeps. The Next.js, Nuxt and SvelteKit adapters read a trace their framework leaves, and any other host had no wait at all; on an adapter the value replaces the wait it sets itself. The call may come before the runtime has loaded, and a later one changes nothing. After five seconds without it the runtime starts anyway and reports `LP0607`, as the other waits do. `inspect().hydration` reports `mode: 'manual'`. Nothing changes for a page that does not set it.
