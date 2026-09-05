---
'payload-live-preview': patch
---

The Nuxt adapter accepts `shouldInject`, like the other three. One behavioral
suite drives all four adapters through the same cases — injection on preview
intent, CSP modes, the one-nonce rule, authorization refusal — which is how
the gap was found.
