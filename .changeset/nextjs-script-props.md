---
'payload-live-preview': minor
---

Add `livePreviewScriptProps()` to the Next.js adapter.

`renderLivePreviewScript()` returns a complete `<script>` tag, which JSX cannot
render — a Next layout has to build the element itself. Every App Router project
therefore wrote the same three lines by hand, and the nonce ended up inside the
script body rather than on the attribute the framework reads.

```tsx
import { livePreviewScriptProps } from 'payload-live-preview/nextjs';

const previewScript = livePreviewScriptProps({
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
  serverURL: process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!,
  mergeDepth: 1,
});

<script {...previewScript} />;
```

`renderLivePreviewScript()` stays for HTML a server assembles as a string.
