# Interop with Payload's official live-preview packages

Payload ships `@payloadcms/live-preview` (the wire client), and
`@payloadcms/live-preview-react` / `-vue` (hooks that re-render a
client-rendered page from the admin's messages). This package is a different
answer to the same message: it patches server-rendered HTML in place and
does not own your components.

## When to use which

| You have                                                                    | Use                                       | Why                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A client-rendered React or Vue app that fetches the document itself         | `@payloadcms/live-preview-react` / `-vue` | The hook hands your components the merged document; re-rendering is what they do anyway.                                                                                |
| Server-rendered pages (Astro, Next App Router, SvelteKit, Nuxt, plain HTML) | this package                              | The page is HTML; the runtime patches bound elements, keeps focus and visitor state (ADR 0008), and needs no client framework.                                          |
| Both on one page (islands inside an SSR shell)                              | this package, islands opt in              | A hydrated island keeps owning its subtree; it receives every update as a `payload-live-preview:update` event and re-renders itself (see [renderers.md](renderers.md)). |

## What is shared, exactly

- **The message.** Both listen for the same `postMessage` the admin sends
  (`type: 'payload-live-preview'`, `data`, `globalSlug`/`collectionSlug`,
  `locale`, `externallyUpdatedRelationship`, and `payload-document-event`).
  The wire corpus under `tests/fixtures/wire-corpus/` holds captures from
  real admins; the weekly protocol watch executes the official client
  against them, so the two packages cannot drift apart unnoticed.
- **The merge.** Payload 3.x posts raw form values; populated relationships
  come from a REST request the official client and this runtime make the
  same way (`serverURL`, `depth`). Payload 2.x posts populated data and a
  `fieldSchemaJSON`; the runtime detects that on the wire
  (`protocol.profile === 'payload-2'`) and skips the request.
- **The handshake.** Both post `ready: true` to the admin; the admin answers
  with the current document.

## Running both on one page

Nothing stops it, but there is rarely a reason: pick the hook for the
subtree a framework renders on the client, and the runtime for the rest.
Mark the framework subtree with `data-payload-island` (or rely on
`<astro-island>`) so the runtime leaves it alone; the hook keeps re-rendering
it from the same message.

## What the official packages do that this one does not

- Re-render arbitrary component trees from data — this runtime patches
  bound elements and, for lists, keyed items; it does not execute templates
  beyond the `data-payload-array-template` mustache.
- Provide React/Vue-specific state (`useLivePreview` returns `isLoading`
  and the document). The runtime exposes the same facts as events
  (`beforeUpdate`, `afterUpdate`, `documentSave`, `relationshipUpdate`) and
  `inspect()`.
