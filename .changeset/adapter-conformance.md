---
'payload-live-preview': patch
---

The Nuxt adapter accepts `shouldInject`, like the other three. One
behavioural suite (`tests/unit/adapters/conformance.ts`) now drives all four
adapters through the same eighteen cases — injection on intent, CSP modes,
the one-nonce rule, authorization refusal — which is how the gap was found.
