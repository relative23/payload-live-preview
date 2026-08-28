---
'payload-live-preview': major
---

Correctness and hardening pass over the whole package before 2.0.

**Fixes you can observe**

- Rich text: Payload 3.x link nodes carry their target in `fields`, which the
  renderer did not read — every link rendered as plain text. Inline blocks and
  tables now render as well.
- The keyed morph could consume live elements when the rendered markup began
  with a comment or indentation the live tree lacked, losing focus and form
  state in exactly the case the morph exists to protect. An attribute with an
  empty value (a boolean marker such as `data-payload-island`) is no longer
  treated as a key, so sibling markers stop sharing one key, and the morph no
  longer strips key attributes off the page to disambiguate duplicates.
- Focus and selection are restored after a keyed move, which is a remove and
  re-insert however the node is retained.
- Strategies were planned against the whole document on every keystroke instead
  of the fields that changed, so a page using fragments re-rendered every
  boundary server-side per keystroke. `dependencies` were silently dropped on
  the route path.
- With `skipUnchanged`, a route refresh reverted every unsaved field except the
  one being typed in.
- `revealEditedField` now follows nested bindings (`hero.title`, fields inside
  blocks and arrays), reveals after the write lands, and never lets a value too
  large or cyclic to compare claim the reveal from a field that changed. On a
  page previewing several documents it reveals the edited document's binding
  rather than the first element that happens to share the field name, and a
  field the server re-renders behind a `data-payload-fragment` boundary is
  revealed once that boundary has landed — previously it was never revealed at
  all, because only patched bindings were considered.
- `destroy()` after `suspend()` was a no-op: the screen-reader live region
  leaked and no `destroy` event was emitted.
- The scheduler could postpone a flush indefinitely under key repeat; it now
  flushes within a bounded window.
- `pll-codegen` could not follow an imported binding to the module that declares
  it, so a config split across files produced no types at all. It also refuses
  to overwrite an existing types file when the schema comes out empty.
- `pll migrate` now rewrites only identifiers bound by an import from this
  package, and reports the sites it cannot rewrite instead of leaving a dangling
  call. `pll doctor` no longer evaluates page-supplied JavaScript, follows
  redirects, or hangs on an origin that never answers.
- Adapters mark every response they change `Cache-Control: private, no-store`
  with `Vary: Cookie`, refuse to rewrite a null-body status, drop `content-encoding`
  and `etag` when they rewrite a body, and keep the CSP nonce out of a response
  header. The SvelteKit handle no longer returns an empty page for a chunk
  without a `<head>`.
- `mergeCspHeader` merges into every policy of a comma-joined header instead of
  widening the last one, and Nuxt no longer replaces an array-valued CSP header.
- `definePreview` reads drafts with `cache: 'no-store'` and can express
  Payload's `or`/`and` queries.
- The fragment and route clients no longer reject when a body read is aborted by
  a newer revision, and the fragment endpoint must be genuinely same-origin.
- A binding that renders a sibling field through `data-payload-href`,
  `data-payload-src` or `data-payload-alt` is re-applied when that sibling
  changes. Under `skipUnchanged` only its own value counted, so editing just the
  URL left the link pointing at the old target while its text updated.
- The Nuxt plugin detects preview intent again when Nitro reports a relative
  `event.url`, and sets response headers on the response object rather than
  through a detached function, which threw on a real Node server.

**Breaking**

- The sanitizer's default policy is `strict` everywhere, not only inside the
  browser runtime. Server-rendered rich text can no longer introduce `id`,
  `name` or `data-payload-*` attributes. Item templates keep the attributes they
  need through the new `templateMode` option.
- Lexical output uses classes instead of data attributes, which the strict
  policy strips: `lp-block--<slug>`, `lp-inline-block--<slug>`,
  `lp-relation--<slug>`, `lp-callout--<importance>`, and `lp-align-*` /
  `lp-indent-*` in place of an inline `style`. Block fields are no longer
  serialised into attributes.
- `email` is its own renderer and writes a `mailto:` URL; it was an alias of
  `url`, which turned an address into a relative link.
- One value contract for every renderer: an empty value or an unsafe URL clears
  the binding and counts as a write, rather than leaving the previous link or
  image in place. `<img>` writes rebuild or remove `srcset`/`sizes`.
- Date bindings write local time into `date` and `datetime-local` inputs.
- `generateInlineScript({ serverURL })` requires an explicit `mergeDepth`, as
  the client and the adapters already did. The deprecated `nonce` option is gone.
- Removed: the `NextMiddleware` type and the `checkFetchDest` option.
- `payload-live-preview/migrate`: `Codemod` now describes a codemod (id, summary,
  ledger entry) without its `apply`, so importing this entry's types no longer
  requires `ts-morph` — an optional peer needed only to _run_ `pll migrate`.
  `CodemodEdit` reports line-level edits instead of whole file contents, and
  `pll migrate` exits `3` when a file needs a human.
- Added: `PreviewAdapterOptions` on every adapter entry, `PreviewConfigurationError`
  (configuration errors from `authorizePreview` are no longer swallowed as an
  outage), the authorization outcome on framework locals, a
  `defineLivePreviewServerHandler` for Nuxt that decides early enough for pages
  to read the verdict, and `SanitizeOptions.templateMode`.
