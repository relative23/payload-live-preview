---
'payload-live-preview': minor
---

On a Nuxt page the runtime's first write no longer lands before Vue has
hydrated. Measured on the example: the runtime wrote the admin's document at
25 ms, Vue hydrated at 94 ms and repaired every written value back to the
server's — quietly, with only a development `console.error` — and what put
them right again was the mock admin answering the runtime's second `ready`;
Payload's admin answers `ready` once, so on a real page the first document was
gone until the editor typed.

Every script the Nuxt adapter emits now declares `hydration: 'vue'` (the
second value of the inline option ADR 0015 added), and under it the runtime
does not start until Vue has mounted the app around the bindings — observed
through the `__vue_app__` property Vue puts on its container as `mount()`
returns, with no polling and no armed bootstrap — and, on Nuxt, until a
Suspense still hydrating at the mount has resolved. The cap, `LP0607` (which
now names the mount it waited for) and `inspect().hydration` (`mode: 'vue'`)
are the ones React's case has. The addendum to ADR 0015 records the
measurement, the signals that were not usable and why, and the failure modes.
