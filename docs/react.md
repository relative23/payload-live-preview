# React hook

`useLivePreviewDocument()` subscribes to the admin's updates and returns the
merged document, so your components re-render with it. Same shape as Payload's
own `useLivePreview`, with this package's merge underneath.

> This is the other half of the package, not a replacement for it. The DOM
> runtime patches server-rendered markup and keeps the visitor's state; a hook
> re-renders the tree and loses it. Which to use, and why a page may want both:
> [renderers.md](renderers.md) and the caveat below.

## Install

```bash
npm install payload-live-preview
```

`react` is an optional peer this package does not install; the `./react` entry
is the only one that imports it, and it does so at module scope, as a hook must.
The published file starts with `'use client'`.

## The hook

```tsx
'use client';
import { useLivePreviewDocument } from 'payload-live-preview/react';

export function PagePreview({ page }: { page: Page }) {
  const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
    serverURL: process.env.NEXT_PUBLIC_PAYLOAD_URL!,
    allowedOrigins: [process.env.NEXT_PUBLIC_PAYLOAD_URL!],
    initialData: page,
    depth: 1,
  });

  return (
    <article>
      <h1>{data.title}</h1>
      {data.subtitle !== undefined && <p className="lede">{data.subtitle}</p>}
      {status === 'unavailable' && <p role="status">Preview paused: {error?.message}</p>}
    </article>
  );
}
```

| Option                    | Default              | What it does                                                           |
| ------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `serverURL`               | required             | Payload origin the update is re-fetched from. A trailing slash is fine |
| `initialData`             | required             | The document the page rendered; returned until an update merges        |
| `depth`                   | `1`                  | Population depth for the merge                                         |
| `apiRoute`                | `/api`               | REST route prefix                                                      |
| `allowedOrigins`          | —                    | Admin origins allowed to post updates                                  |
| `eventSourcePolicy`       | `'parent-or-opener'` | `'any'` accepts a message from any window at an allowed origin         |
| `enableReferrerDetection` | `false`              | Trust `document.referrer` as an origin source                          |
| `enableLocalhostMatching` | `true`               | Match `localhost` origins in development                               |

The return value is `{ data, isLoading, status, error }`. `data` and `isLoading`
are Payload's two, with the same meaning — `isLoading` is `true` until the first
update merges. `status` is `'idle'` before the first update, `'live'` when the
newest one merged, `'unavailable'` when it did not; `error` says why, and only
then.

## Measured against the official package

`@payloadcms/live-preview` is the right choice for a React app that owns the
document anyway: one hook, no attributes, and the tree it re-renders is yours.
What follows is not an argument against that. It is what seven cases did when
both packages were run through the same input.

Every case runs twice in this repository — against this hook in
[`document-session.test.ts`](../tests/unit/adapters/document-session.test.ts),
and against `@payloadcms/live-preview` 3.88.0 in
[`payload-hook-comparison.test.ts`](../tests/unit/adapters/payload-hook-comparison.test.ts),
which imports the published package rather than describing it.
`npm run test:upstream-findings` runs the same cases against whatever the
registry serves today, so a row upstream has since fixed turns red here instead
of standing as a claim.

### Five where the results differ

| Measured with                                                                  | `@payloadcms/live-preview` 3.88.0                                              | This hook                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `serverURL` `https://cms.example.com/`, message from `https://cms.example.com` | no request at all; every callback hands back the document the page started on  | `POST https://cms.example.com/api/pages/1`                        |
| Two messages, the first answered after 80 ms, the second after 5 ms            | callbacks in the order `NEW`, `OLD` — the older document is the one that stays | `data` is the newer one, and still is after the slow answer lands |
| HTTP 403 with the body `{"errors":[{"message":"Forbidden"}]}`                  | the callback receives that object; the document's fields are gone              | `data` unchanged, `status: 'unavailable'`, `error` names the 403  |
| Two previews on one page, documents `1` and `2`                                | the second one's merge fetches `pages/1` — `previousData` is module-level      | each keeps its own document (ADR 0002)                            |
| `collectionSlug: '../../admin'` in the message                                 | request endpoint `../../admin/1`, sent with `credentials: 'include'`           | no request; the merge is refused                                  |

### Two the hook does not fix

| Measured with                                       | `@payloadcms/live-preview` 3.88.0                                                                    | This hook                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `fetch` rejecting with `TypeError: Failed to fetch` | the rejection escapes an async listener nobody awaits; the page keeps the old value and says nothing | last good document kept, `status: 'unavailable'`, `error` names it |
| A burst of typing, one message per keystroke        | 30 requests on 27 keystrokes, counted in a 3.88 admin                                                | one request per accepted message, with nothing in front of them    |

Neither of those two is a win. The update lost to a failed request is lost in
both: no retry, and the preview catches up only on the next message. And neither
package coalesces a burst — the debounce this one has slows the writes the DOM
runtime makes, not the requests it sends (`npm run test:interaction` records 18
requests for an 18-keystroke burst), and the hook has no debounce at all.

The merge itself is the same protocol: a `POST` to the REST API with
`X-Payload-HTTP-Method-Override: GET`, which returns the stored document with
the unsaved values applied and relationships populated.

Origin trust is this package's, not the admin's word: a message is accepted only
from an allowed origin, and by default only from the window that framed or
opened the page ([authorization.md](authorization.md) for the wider model).

## The caveat that decides which one you want

A hook re-renders. React replaces the subtree, and with it goes what the visitor
was doing: focus, the caret, an open `<details>`, a scroll position inside the
region, the state of any uncontrolled input. For an editor typing into the admin
that is usually invisible; for a preview someone is interacting with, it is the
whole difference.

The DOM runtime writes values into the existing elements instead, which is why
it keeps all of that — and why it cannot create markup the page did not render.
The two are complementary:

- **Bindings** (`data-payload-field`) for server-rendered regions.
- **Fragments** (`data-payload-fragment`) when a region needs its own logic
  rendered on the server ([hybrid.md](hybrid.md)).
- **This hook** inside a client component that owns its subtree anyway — mark
  its root `data-payload-island` so the runtime leaves it alone
  ([interop.md](interop.md)).

## Vue

The same composable, the same session, the same seven cases:
[vue.md](vue.md).

## Server rendering

`useLivePreviewDocument` renders `initialData` on the server: there is no window
and no message, so the first client render matches it and hydration is quiet.
The subscription starts after mount.
