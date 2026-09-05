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
| Server-rendered pages (Astro, Next App Router, SvelteKit, Nuxt, plain HTML) | this package                              | The page is HTML; the runtime patches bound elements, keeps focus and visitor state, and needs no client framework.                                                     |
| Both on one page (islands inside an SSR shell)                              | this package, islands opt in              | A hydrated island keeps owning its subtree; it receives every update as a `payload-live-preview:update` event and re-renders itself (see [renderers.md](renderers.md)). |

For React Server Components, Payload's `RefreshRouteOnSave` is the
save-triggered equivalent of this package's route strategy.

## What is shared, exactly

- **The message.** Both listen for the same `postMessage` the admin sends
  (`type: 'payload-live-preview'`, `data`, `globalSlug`/`collectionSlug`,
  `locale`, `externallyUpdatedRelationship`, and `payload-document-event`).
  Messages captured from real admins are replayed through this runtime in
  its test suite, and a weekly check executes the official client against
  the same captures, so the two packages cannot drift apart unnoticed.
- **The merge.** Payload 3.x posts raw form values; populated relationships
  come from a REST request the official client and this runtime make the
  same way (`serverURL`, `depth`). Payload 2.x posts populated data and a
  `fieldSchemaJSON`; the runtime detects that on the wire
  (`protocol.profile === 'payload-2'`) and skips the request.
- **The handshake.** Both post `ready: true` to the admin; the admin answers
  with the current document.

## Moving from `@payloadcms/live-preview-react`

The two packages coexist; the move is per page or per region, not per
project:

1. Stop calling `useLivePreview()` in the components that render the region.
2. Annotate the **rendered** DOM with `data-payload-field` attributes
   ([bindings.md](bindings.md)).
3. Mount this package once: an adapter, or `generateInlineScript()`.
4. Updates flow into the DOM directly; no re-render is involved.

Keep bindings outside hydrated React, Vue or Svelte islands: a later
component render overwrites direct DOM patches. Inside such islands, keep the
official framework hook so the owning component tree performs the update.

## Running both on one page

Nothing stops it, and an SSR shell with hydrated islands is exactly that
page: the hook for the subtree a framework renders on the client, the
runtime for the rest. Mark the framework subtree with `data-payload-island`
(or rely on `<astro-island>`) so the runtime leaves it alone; the hook keeps
re-rendering it from the same message.

## What the official packages do that this one does not

- Re-render arbitrary component trees from data — this runtime patches
  bound elements and, for lists, keyed items; it does not execute templates
  beyond the `data-payload-array-template` mustache. A component's own logic
  is available through the fragment strategy instead
  ([hybrid.md](hybrid.md)).
- Provide React/Vue-specific state (`useLivePreview` returns `isLoading`
  and the document). The runtime exposes the same facts as events
  (`beforeUpdate`, `afterUpdate`, `documentSave`, `relationshipUpdate`) and
  `inspect()`.
