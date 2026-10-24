# Interop with Payload's official live-preview packages

Payload ships `@payloadcms/live-preview` (the wire client), and
`@payloadcms/live-preview-react` / `-vue` (hooks that re-render a
client-rendered page from the admin's messages). This package is a different
answer to the same message: it patches server-rendered HTML in place and
does not own your components.

## When to use which

| You have                                                                    | Use                                       | Why                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A client-rendered React or Vue app that fetches the document itself         | `@payloadcms/live-preview-react` / `-vue` | The hook hands your components the merged document; re-rendering is what they do anyway.                                                                                               |
| Server-rendered pages (Astro, Next App Router, SvelteKit, Nuxt, plain HTML) | this package                              | The runtime patches bound elements without a client framework; compatible nodes retained by a fragment or route morph keep their live properties.                                      |
| Both on one page (islands inside an SSR shell)                              | this package, islands opt in              | A hydrated island owns its subtree and re-renders on a `payload-live-preview:update` event, which follows every revision that carried a change ([renderers.md](renderers.md#islands)). |

For React Server Components, Payload's `RefreshRouteOnSave` is the
save-triggered equivalent of this package's route strategy.

## What is shared, exactly

- **The message.** Both listen for the same `postMessage` the admin sends
  (`type: 'payload-live-preview'`, `data`, `globalSlug`/`collectionSlug`,
  `locale`, `externallyUpdatedRelationship`, and `payload-document-event`).
  Messages captured from real admins are replayed through this runtime in
  its test suite, and a daily check executes the official client against
  the same captures, so the two packages cannot drift apart unnoticed.
- **The merge.** Payload 3.x posts raw form values; populated relationships
  come from a REST request the official client and this runtime make the
  same way (`serverURL`, `depth`). The measured Payload 2.32.3 sender can
  post raw relationship IDs. It sends `fieldSchemaJSON` on the first send
  and after a window-type change; later messages can omit it. This package
  retains accepted schema within each session and uses credentialed collection
  GETs when population is needed, with the configured depth and any supplied
  locale. The v2 schema path does not use the v3 method-override POST. A session
  captured from a real Payload 2.32.3 admin
  (`tests/fixtures/wire-corpus/payload-2.32.3.json`) is replayed with the 3.x
  and 4.0 canary captures; it edits text, rich text and an array across a save,
  and contains no relationship field.
- **The handshake.** Both post `ready: true` to announce that the receiver is
  listening. This is a best-effort hint, not a document or schema resend
  guarantee. In the measured Payload 2.32.3 provider, replacing a hook or
  reloading only the child iframe does not itself reset the parent's
  readiness state or first-send schema cache. A fresh hook starts from its
  own `initialData` and cannot borrow another session's schema, so it reports
  `'unavailable'` and reads nothing. Loading the admin page again sends a
  schema with its first message and the preview populates again. The lifecycle
  probe of `examples/payload-version-lanes` measures both steps in development
  builds.

## Moving from `@payloadcms/live-preview-react`

The two packages coexist; the move is per page or per region, not per
project:

1. Stop calling `useLivePreview()` in the components that render the region.
2. Annotate the **rendered** DOM with `data-payload-field` attributes
   ([bindings.md](bindings.md)).
3. Mount this package once: an adapter, or `generateInlineScript()`. An
   adapter that decides per request (`inject: 'preview-only'`, the default)
   injects the runtime only when the URL carries a `preview`, `draft` or
   `livePreview` query parameter set to `true` or `1`. Add one to the admin's
   preview URL, or let the config plugin from `payload-live-preview/plugin`
   write that URL; it throws while the old `admin.livePreview.url` is still in
   place ([payload.md](payload.md#merge-rules)).
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

Framework state is not on that list: `useLivePreviewDocument()` from
`payload-live-preview/react` and `payload-live-preview/vue` returns
`{ data, isLoading, status, error, revision }` (refs, in Vue) for a client-rendered
component ([react.md](react.md), [vue.md](vue.md)). The DOM runtime exposes the
same facts as events (`beforeUpdate`, `afterUpdate`, `documentSave`,
`relationshipUpdate`) and `inspect()`.
