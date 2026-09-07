---
'payload-live-preview': minor
---

A route refresh the minimum interval holds back is now run once when the
interval closes, instead of being dropped.

The route strategy refreshes at most once per `minIntervalMs` (1 000 ms). Until
now a request that fell inside that window was refused and thrown away, so the
change that ended a burst of typing never reached the preview at all: two
unbound changes 286 ms apart produced one refresh, one refusal, and — if the
editor then stopped typing — a preview that stayed wrong until the next
navigation. The refused request is now remembered and runs once when the window
closes; a newer revision takes the pending run over, because its message carries
the older one's values too. The page is still patched immediately with whatever
it can show, so nothing waits for the window that did not have to.

`inspect().route` gained **`refused`**, and refusals no longer count as
`failed`. A planned pause and a broken request are different things, and one
number for both made the reading useless — `failed: 3` could mean nothing was
wrong.

New: **`<LivePreviewRouteRefresh />`** from `payload-live-preview/react`, and
`registerRouteRefresh()` for hosts that are not React. A route refresh normally
fetches the route and morphs it into the living page — on a React page that is
DOM the reconciler owns, and it was seen to break there once (`removeChild` on
`null` inside React's commit phase). Given the host router's own refresh, the
strategy uses it instead: the framework re-renders, there is no morph, and the
extra HTML request disappears. In Next's App Router:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { LivePreviewRouteRefresh } from 'payload-live-preview/react';

export function LivePreviewRefresh() {
  return <LivePreviewRouteRefresh refresh={useRouter().refresh} />;
}
```

Nothing to configure otherwise, and a page that registers no refresh fetches and
morphs exactly as before. `RouteStrategy.refresh` may now resolve `'refused'`
alongside `'refreshed' | 'failed' | 'superseded'`; a custom strategy that never
returns it is unaffected.
