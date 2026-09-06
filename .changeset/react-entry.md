---
'payload-live-preview': minor
---

Add `payload-live-preview/react`: `useLivePreviewDocument()`, the merged document
as a hook.

The package patched the DOM and left the hook to Payload's own package. That is
the right split for markup a server renders, but a client-rendered app has no
markup to patch, and the official hook has five behaviours this package already
solved for its runtime:

| Case                                 | `@payloadcms/live-preview` 3.88         | This hook                               |
| ------------------------------------ | --------------------------------------- | --------------------------------------- |
| `serverURL` with a trailing slash    | every message ignored, silently         | merged                                  |
| A slow response overtaken by a newer | the older one lands last                | the newer wins, the older is discarded  |
| The request fails                    | unhandled rejection, page keeps the old | `status: 'unavailable'`, last good kept |
| HTTP 403                             | the error body becomes `data`           | refused, `data` unchanged               |
| Two hooks on one page                | one module-level cache, shared          | one session each (ADR 0002)             |

Each row is asserted twice in this repository: once against this hook, once
against the official package, which is a devDependency here. If a later release
changes any of it, the comparison test fails and the claim goes.

```tsx
'use client';
import { useLivePreviewDocument } from 'payload-live-preview/react';

const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
  serverURL: process.env.NEXT_PUBLIC_PAYLOAD_URL!,
  allowedOrigins: [process.env.NEXT_PUBLIC_PAYLOAD_URL!],
  initialData: page,
  depth: 1,
});
```

`{ data, isLoading }` are Payload's two, with the same meaning; `status` and
`error` are added, so a merge that fails is visible instead of looking like a
document that did not change.

The hook re-renders the tree, which loses focus, the caret and every other bit of
visitor state the DOM runtime keeps — the trade is written down in docs/react.md,
including when a page wants both. `react` is an optional peer, imported by this
entry alone; the published file starts with `'use client'`.
