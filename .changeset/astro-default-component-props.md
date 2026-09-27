---
'payload-live-preview': patch
---

Pass fragment component props through an internal Astro-compiled bridge. Astro 4.9.0's Container API did not accept the props option, so the default endpoint could return HTTP 200 without the requested component content. The bridge uses public per-render locals and normal component props, remains internal and lazy, and preserves custom renderers and optional-peer imports. Pages still own component CSS; verified page context and additional framework renderers still require the existing render override.
