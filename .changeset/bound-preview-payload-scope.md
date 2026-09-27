---
'payload-live-preview': minor
---

Add opt-in `scope.payload` document capabilities to verifier contexts. Shared fragment endpoints check document identity before rendering; `definePreview` checks the Payload API base, document, locale, depth and expiry before forwarding headers and validates the returned identity. Scoped collection reads require the new direct `id` form, without `where`. Existing unscoped contexts keep their query behavior. Read configuration is captured once, and verified headers win case-insensitively. See the authorization guide and ADR 0006 §5c; no session store or token-format change is included.
