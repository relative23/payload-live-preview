---
'payload-live-preview': patch
---

The sanitizer policy is per client instance. `sanitizerPolicy` — from the
client configuration or the inline script — travels with its runtime into
every renderer's `RenderContext` (`context.sanitizerPolicy`), so two clients
on one page each sanitize with their own policy, and constructing one no
longer changes what the other renders. `setSanitizerPolicy()` remains the
process-wide default for code that calls `sanitizeHtml()` directly, and the
fallback for a render context without a policy.
