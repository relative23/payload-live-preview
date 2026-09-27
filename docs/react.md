# React hook

`useLivePreviewDocument()` subscribes to the admin's updates and returns the
merged document, so your components re-render with it. Same shape as Payload's
own `useLivePreview`, with this package's merge underneath.

> This is the other half of the package, not a replacement for it. The DOM
> runtime patches server-rendered markup; a hook gives React the new document
> and lets its reconciler update the client-owned tree. A stable component
> identity preserves component and DOM state. A changed type, key or position
> can cause a remount or replacement; the replaced node loses its state. Which
> owner to use, and why one page may use both: [renderers.md](renderers.md) and
> the caveat below.

## Install

```bash
npm install payload-live-preview
```

`react` is an optional peer this package does not install. The `./react` entry
imports it at module scope, as a hook must; `./nextjs` loads `react`, and
`react-dom/server` for a fragment endpoint, only at the first render that needs
it. The published `./react` file starts with `'use client'`.

## The hook

```tsx
'use client';
import { useLivePreviewDocument } from 'payload-live-preview/react';

export function PagePreview({ page }: { page: Page }) {
  const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
    serverURL: process.env.NEXT_PUBLIC_PAYLOAD_URL!,
    allowedOrigins: [process.env.NEXT_PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
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

Both `NEXT_PUBLIC_` values ship to the browser. They are origins, not
credentials; keep preview tokens and other secrets in server-only variables.

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

A hook instance owns one document session. A fresh `initialData` object on an
ordinary re-render does not replace data that already merged. If the same
component can move from one CMS document to another, remount it with a key that
includes the document owner and id. This releases the old session and starts a
new one from the new `initialData`.

The return value is `{ data, isLoading, status, error }`. `data` and `isLoading`
are Payload's two names. `isLoading` is `true` until an update settles, turns
`true` again with every update it accepts, and is `false` once the newest one
has merged or failed to. `status` is `'idle'` before the first update, `'live'`
when the newest one merged, `'unavailable'` when it did not; `error` says why,
and only then.

## Measured against the official package

`@payloadcms/live-preview` is Payload's framework-independent message and merge
client; `@payloadcms/live-preview-react` wraps it for a React app. The official
wrapper is a natural choice when that app owns the document: one hook, no DOM
attributes. What follows is not an argument against it. It records five client
cases where this package's session and Payload's base client received the same
input.

All five cases run twice in this repository — against the session this hook uses
in [`document-session.test.ts`](../tests/unit/adapters/document-session.test.ts),
and against the lockfile's exact `@payloadcms/live-preview` 3.88.0 in
[`payload-hook-comparison.test.ts`](../tests/unit/adapters/payload-hook-comparison.test.ts),
which imports the installed package rather than describing it (last verified
2026-09-23). These are client-session tests, not React rendering or tarball
consumer tests.

The scheduled `npm run test:upstream-findings` is a separate drift probe. It
runs seven low-level observations against the requested registry version; its
case set overlaps this table but is not identical, and it does not exercise the
React wrapper.

### Five where the results differ

| Measured with                                                                  | `@payloadcms/live-preview` 3.88.0                                              | This hook                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `serverURL` `https://cms.example.com/`, message from `https://cms.example.com` | no request at all; every callback hands back the document the page started on  | `POST https://cms.example.com/api/pages/1`                         |
| Two messages, the first answered after 80 ms, the second after 5 ms            | callbacks in the order `NEW`, `OLD` — the older document is the one that stays | `data` is the newer one, and still is after the slow answer lands  |
| HTTP 403 with the body `{"errors":[{"message":"Forbidden"}]}`                  | the callback receives that object; the document's fields are gone              | `data` unchanged, `status: 'unavailable'`, `error` names the 403   |
| Two previews on one page, documents `1` and `2`                                | the second one's merge fetches `pages/1` — `previousData` is module-level      | each keeps its own document (ADR 0002)                             |
| `fetch` rejecting with `TypeError: Failed to fetch`                            | the rejection escapes the async listener                                       | last good document kept, `status: 'unavailable'`, `error` names it |

The failed update is not retried: this hook reports it and catches up on the
next message. It also sends one merge request per accepted message. The DOM
runtime's debounce delays writes, not those requests; `npm run test:interaction`
records 18 requests for an 18-keystroke burst.

The merge itself is the same protocol: a `POST` to the REST API with
`X-Payload-HTTP-Method-Override: GET`, which returns the stored document with
the unsaved values applied and relationships populated.

Origin trust is this package's, not the admin's word: a message is accepted only
from an allowed origin, and by default only from the window that framed or
opened the page ([authorization.md](authorization.md) for the wider model).

## The caveat that decides which one you want

A render is not a remount. React preserves component state and usually the
underlying DOM node while its type, key and position remain stable. It can still
write controlled values, and a conditional branch, changed key or changed type
can replace the node. A remount loses state held by that component or DOM node,
including an uncontrolled value, focus or an inner scroll position.

The DOM runtime has a different ownership model. A scalar binding writes the
existing element directly. A fragment or route render is morphed: compatible,
paired live nodes retain their properties, while incompatible or unpaired nodes
are replaced and lose them. Direct patches cannot create markup the page did
not render; React can render conditional markup from the new document. The two
approaches are complementary:

- **Bindings** (`data-payload-field`) for server-rendered regions.
- **Fragments** (`data-payload-fragment`) when a region needs its own logic
  rendered on the server ([hybrid.md](hybrid.md)).
- **This hook** inside a client component that owns its subtree anyway — mark
  its root `data-payload-island` so the runtime leaves it alone
  ([interop.md](interop.md)).

## Lending the runtime your router

`<LivePreviewRouteRefresh refresh={...} />` hands the DOM runtime the host
router's refresh, so a route update is a re-render React performs rather than
server HTML this package morphs over the reconciler's nodes. It renders
nothing, registers while it is mounted, and gives the registration back on
unmount; without it the route strategy fetches and morphs as before. Wiring for
Next's App Router: [nextjs.md](nextjs.md). Outside React the same seam is
`registerRouteRefresh()`.

## Vue

The same composable, the same session, the same five cases:
[vue.md](vue.md).

## Server rendering

`useLivePreviewDocument` renders `initialData` on the server: there is no window
and no message, so the first client render matches it and hydration is quiet.
The subscription starts after mount.
