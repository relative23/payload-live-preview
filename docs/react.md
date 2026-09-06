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

## What it does differently

The differences are not stylistic. Each is a case where the official package
shows something that is not the document, and each is asserted twice in this
repository — once against this hook, once against `@payloadcms/live-preview`
3.88 ([tests/unit/adapters](../tests/unit/adapters)):

| Case                                 | `@payloadcms/live-preview` 3.88         | This hook                               |
| ------------------------------------ | --------------------------------------- | --------------------------------------- |
| `serverURL` with a trailing slash    | every message ignored, silently         | merged                                  |
| A slow response overtaken by a newer | the older one lands last                | the newer wins; the older is discarded  |
| The request fails                    | unhandled rejection, page keeps the old | `status: 'unavailable'`, last good kept |
| HTTP 403                             | the error body becomes `data`           | refused; `data` unchanged               |
| Two hooks on one page                | one module-level cache, shared          | one session each (ADR 0002)             |

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

The same composable, the same session, the same five differences:
[vue.md](vue.md).

## Server rendering

`useLivePreviewDocument` renders `initialData` on the server: there is no window
and no message, so the first client render matches it and hydration is quiet.
The subscription starts after mount.
