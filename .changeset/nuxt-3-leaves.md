---
'payload-live-preview': major
---

Nuxt 3 is no longer tested (ADR 0007, row 45). It reached its end of life on 31 July 2026, and 2.x kept it working with an example of its own. That example is gone: the one Nuxt example runs Nuxt 4 in the `app/` layout, on its development server against the mock admin and from the real admin, and as a production build.

The module's code did not change with that. A Nuxt 3 project keeps the code it has, without a job that proves it; Nuxt's own upgrade guide moves it to 4.
