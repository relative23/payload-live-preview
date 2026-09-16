# payload-live-preview

## 2.0.1

### Patch Changes

- 637d7d8: `pll doctor` can audit the preview 2.0 sets up by default, and `pll migrate` says what the `isPreviewRequest` rename keeps.

  - The preview probe requests the page with `?preview=true`, the intent a 2.0 adapter counts (`previewSignals: ['query']`). It used to send `Sec-Fetch-Dest: iframe` alone, which a 2.0 adapter does not read as intent, so a default 2.0 deployment answered it like an ordinary visit and every audit reported LP0701. The visitor probe drops the intent parameters (`preview`, `draft`, `livePreview`, or the names given with `--param` for an adapter whose `previewQueryParams` replaces them), so the two requests still differ in exactly that; the rest of the query is fetched byte for byte as given.
  - `--header "Name: value"` (or `-H`, repeatable) sends an editor's credentials with the preview probe only: a Payload session `Cookie` or an `x-preview-token`. A preview behind `authorizePreview`, the strict 2.0 default, answers a request without them exactly like a page that never injects; LP0701 and the LP0709 about an unreadable configuration now name that reading and the option. Values never appear in the report, a header name given twice is refused, and the probe's own headers win over a caller's spelling of them. Programmatic callers pass `previewHeaders` and `previewQueryParams` to `runDoctor()`.
  - After renaming `isPreviewRequest()` to `hasPreviewIntent()`, `pll migrate` notes that the new name takes the same options and, without `signals`, counts the same three signals, while the 2.0 adapters count only the query: pass `{ signals: ['query'] }` where a call should agree with them. The note does not change the exit code.

- 98fad2f: `autoBind: 'unique'` now keeps the guesses inside a fragment boundary.

  A fragment render morphs its boundary toward the server's markup, and that
  markup carries no `data-payload-field` stamp, so every guess in the boundary
  went with it. The first message renders a boundary as well, which means a guess
  inside one never outlived that message; on a page with `fragments` and no route
  strategy nothing brought it back, and edits to that field never reached the
  preview. After a rendered fragment the runtime now looks for the baseline's own
  guesses again — the search a route refresh already ran — and for nothing else: a
  value the render brought in is still not bound.

  The lean profile renders no fragments and is unchanged; its runtime is
  byte-identical.

- 637d7d8: The preview no longer loses the last keystroke when the page is busy.

  While an editor types into a field the server has to populate, the runtime sends one merge request as a burst starts and one as it ends. The end of the window is decided by the clock but sent by a timer, and a timer can run late: a busy main thread, a throttled engine. The last keystroke then went out as a new request first, and the late timer sent the older queued state after it. The answer to the older state replaced the newer one, and the preview showed the second-to-last text until the next keystroke or save. A new request now drops the queued older one before it goes out. What was saved was never affected. Found in WebKit against a real Payload admin; the batching arrived in 2.0.0-rc.1, and 1.8.1 does not have it.

- 637d7d8: A Next.js cache header now follows the runtime's own reading of preview intent, and two diagnostics stop describing things that did not happen.

  - `withLivePreview()` marks `?preview=1`, `?draft=1` and `?livePreview=1` `private, no-store`, as it already did for `=true`. The runtime has always read both `true` and `1` as intent, but Next evaluates a header rule's `value` as an anchored regular expression and the rule named only `true`, so a preview response reached with `=1` could be kept by a shared cache. Measured with `next build` and `next start` on Next.js 16.3.0: `?preview=1` answered `public, max-age=0` before, `private, no-store` after; `?preview=0` and `?preview=x1` stay public.
  - LP0104 told a page on the lean runtime to remove `profile: 'lean'`, a field of the `LEAN_RUNTIME` artifact that nobody writes. It names `runtime: LEAN_RUNTIME`, the option that delivered it.
  - LP0409 said the 1.x default (`sanitizerPolicy: 'compat'`) kept `name`. It did not — no built-in per-tag list allows it — so the warning sent an upgrader looking for a regression that was not one. `name` is reported only where `additionalAllowedAttributes` lets `compat` keep it.

## 2.0.0

### Major Changes

- 14e967d: Correctness and hardening pass over the whole package for 2.0.

  **Fixes you can observe**

  - Rich text: Payload 3.x link nodes carry their target in `fields`, which the
    renderer did not read — every link rendered as plain text. Inline blocks and
    tables render as well.
  - The keyed morph could consume live elements when the rendered markup began
    with a comment or indentation the live tree lacked, losing focus and form
    state in exactly the case the morph exists to protect. An attribute with an
    empty value (a boolean marker such as `data-payload-island`) is not a key,
    so sibling markers stop sharing one key, and the morph no longer strips key
    attributes off the page to disambiguate duplicates.
  - Focus and selection are restored after a keyed move, which is a remove and
    re-insert however the node is retained.
  - Strategies were planned against the whole document on every keystroke
    instead of the fields that changed, so a page using fragments re-rendered
    every boundary server-side per keystroke. `dependencies` were silently
    dropped on the route path.
  - With `skipUnchanged`, a route refresh reverted every unsaved field except
    the one being typed in.
  - `revealEditedField` follows nested bindings (`hero.title`, fields inside
    blocks and arrays), reveals after the write lands, and never lets a value too
    large or cyclic to compare claim the reveal from a field that changed. On a
    page previewing several documents it reveals the edited document's binding
    rather than the first element that happens to share the field name, and a
    field the server re-renders behind a `data-payload-fragment` boundary is
    revealed once that boundary has landed — previously it was never revealed at
    all, because only patched bindings were considered.
  - `destroy()` after `suspend()` was a no-op: the screen-reader live region
    leaked and no `destroy` event was emitted.
  - The scheduler could postpone a flush indefinitely under key repeat; it
    flushes within a bounded window.
  - `pll-codegen` could not follow an imported binding to the module that
    declares it, so a config split across files produced no types at all. It
    also refuses to overwrite an existing types file when the schema comes out
    empty.
  - `pll migrate` rewrites only identifiers bound by an import from this
    package, and reports the sites it cannot rewrite instead of leaving a
    dangling call. `pll doctor` no longer evaluates page-supplied JavaScript,
    follows redirects, or hangs on an origin that never answers.
  - Adapters mark every response they change `Cache-Control: private, no-store`
    with `Vary: Cookie`, refuse to rewrite a null-body status, drop
    `content-encoding` and `etag` when they rewrite a body, and keep the CSP
    nonce out of a response header. The SvelteKit handle no longer returns an
    empty page for a chunk without a `<head>`.
  - `mergeCspHeader` merges into every policy of a comma-joined header instead
    of widening the last one, and Nuxt no longer replaces an array-valued CSP
    header.
  - `definePreview` reads drafts with `cache: 'no-store'` and can express
    Payload's `or`/`and` queries.
  - The fragment and route clients no longer reject when a body read is aborted
    by a newer revision, and the fragment endpoint must be genuinely
    same-origin.
  - A binding that renders a sibling field through `data-payload-href`,
    `data-payload-src` or `data-payload-alt` is re-applied when that sibling
    changes. Under `skipUnchanged` only its own value counted, so editing just
    the URL left the link pointing at the old target while its text updated.
  - The Nuxt plugin detects preview intent when Nitro reports a relative
    `event.url`, and sets response headers on the response object rather than
    through a detached function, which threw on a real Node server.

  **Breaking**

  - The sanitizer's default policy is `strict` everywhere, not only inside the
    browser runtime. Server-rendered rich text can no longer introduce `id`,
    `name` or `data-payload-*` attributes. Item templates keep the attributes
    they need through `SanitizeOptions.templateMode`.
  - Lexical output uses classes instead of data attributes, which the strict
    policy strips: `lp-block--<slug>`, `lp-inline-block--<slug>`,
    `lp-relation--<slug>`, `lp-block-<kind>` for the built-in blocks (callout,
    image, video, code, cta), and `lp-align-*` / `lp-indent-*` in place of an
    inline `style`. Block fields are no longer serialized into attributes.
  - `email` is its own renderer and writes a `mailto:` URL; in 1.x it was an
    alias of `url`, which turned an address into a relative link.
  - One value contract for every renderer: an empty value or an unsafe URL
    clears the binding and counts as a write, rather than leaving the previous
    link or image in place. `<img>` writes rebuild or remove `srcset`/`sizes`.
  - Date bindings write local time into `date` and `datetime-local` inputs.
  - `generateInlineScript({ serverURL })` requires an explicit `mergeDepth`, as
    the client and the adapters do. The `nonce` option is gone; pass the nonce to
    `wrapWithScriptTag()`.
  - Removed: the `NextMiddleware` type and the `checkFetchDest` option.
  - `payload-live-preview/migrate`: `Codemod` describes a codemod (id, summary,
    ledger entry) without its `apply`, so importing this entry's types does not
    require `ts-morph` — an optional peer needed only to _run_ `pll migrate` and
    `pll-codegen`. `CodemodEdit` reports line-level edits instead of whole file
    contents, and `pll migrate` exits `3` when a file needs a human.
  - Added: `PreviewAdapterOptions` on every adapter entry; a configuration error
    thrown by `authorizePreview` propagates instead of being swallowed as an
    outage; the authorization outcome on framework locals
    (`LivePreviewLocals`); `defineLivePreviewServerHandler` for Nuxt, which
    decides early enough for pages to read the outcome; and
    `SanitizeOptions.templateMode`.

- c520ff1: 2.0 is secure and explicit by default. The hardened readiness table is the
  default profile: production response changes require an authorization
  (`strict`), the intent signal is the query string alone (the `fetch-dest` and
  `referer` signals are opt-in through `previewSignals`), `allowedOrigins` are
  required and must be `https:`, referrer trust is off, messages must come from
  the window that framed or opened the page, unchanged bindings are skipped, and
  the sanitizer runs in strict mode. `serverURL` requires an explicit
  `mergeDepth` (`0` for none). `defaults: 'v1'` restores the whole 1.x table on
  the adapters, the client and the inline script; every row is also an option,
  so a migration can move one row at a time.

  Removed, with `pll migrate` rewriting each call site:

  - `isPreviewRequest()` — use `hasPreviewIntent()`.
  - the root `fetchPreviewDocument()` / `fetchPreviewGlobal()` helpers — use
    `definePreview()` from `payload-live-preview/server`.
  - `createPreviewBindings({ authorized: boolean })` — pass `{ authorization }`
    from `authorizePreviewRequest()`.

  The Astro integration's `mode: 'middleware'` refuses to build under `strict`:
  it serializes its options into the build, so it cannot carry the
  `authorizePreview` function strict mode requires. Without the check this
  combination builds cleanly and then answers every preview request with a 500.
  Register `createLivePreviewMiddleware({ authorizePreview })` in your own Astro
  middleware instead, or pass `defaults: 'v1'` / `strict: false` for intent-only
  middleware.

  Migration: run `pll migrate <path>` to rewrite the renamed and moved APIs, and
  `pll doctor --v2 <url>` to audit a served page against the new defaults.
  docs/migration.md walks the table row by row with before/after examples.

### Minor Changes

- 084217a: Add `pll-codegen annotate`: put `data-payload-field` where a template already
  prints a field, and report every place it will not guess at.

  ```bash
  npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts
  npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts --write
  ```

  Annotating a template by hand is the work this package asks for, and on an
  existing site it is the reason to keep using a hook instead. The codemod does the
  part that is unambiguous: an element whose entire content is one field access
  whose path the schema has — the shape that means the same thing in Astro, JSX and
  Svelte.

  ```astro
  <h1>{page.title}</h1>  →  <h1 data-payload-field="title">{page.title}</h1>
  ```

  Everything else is listed with a reason and left untouched: a value printed
  beside a label (a binding replaces the whole text), a call or an operator (no
  single field to name), a path the schema does not have, an array item inside a
  loop (nothing connects the loop variable to the field), a component's props, and
  anything already annotated. A missing binding costs an editor one invisible edit;
  a wrong one writes a value into the wrong element on every keystroke, and nobody
  looks for that in a diff a codemod produced.

  Nothing is written without `--write`. A dry run that found work exits 3, so a
  pre-commit hook can tell it apart from "nothing to do".

- 084217a: `delivery: 'asset'`: the runtime as a cached file instead of part of the page.

  A preview page carries about 30 KB gzip of runtime today. With `delivery: 'asset'` it carries a bootstrap instead — 679 bytes, measured on the Next.js example — which checks for a preview context and only then fetches the runtime from a route you mount:

  ```ts
  // app/payload-live-preview/[file]/route.ts
  import { createRuntimeAssetRoute } from 'payload-live-preview/nextjs';

  export const { GET } = createRuntimeAssetRoute(livePreviewOptions);
  ```

  The file is named after the hash of its contents, so the response says `Cache-Control: public, max-age=31536000, immutable` and means it, and the bootstrap loads it with `integrity` and `crossorigin="anonymous"`. The route answers that one name and 404s every other, rather than returning current bytes under an old name.

  `createRuntimeAssetRoute()` exists in all three route-serving adapters, each in the shape its framework wants: `export const { GET } = …` for a Next.js route file and a SvelteKit `+server.ts`, and a `Request` → `Response` function for a Nitro handler. What they answer is the same, because delivery is decided once, where the script body is built. Astro already had this as `mode: 'loader'` and keeps it — it emits and serves the file from its own build — but now reads the same asset descriptor rather than a second copy of it, and honours `runtime: LEAN_RUNTIME` there too.

  `RuntimeArtifact` gained `contentHash` and `integrity`, because an artifact that can be served has to be able to name and verify itself.

- 11dacbf: `autoBind: 'unique'` lets the runtime find bindings by value on the
  connection's first message, for a page that carries no `data-payload-field` at
  all. A scalar field whose value is the whole content of exactly one element in
  the body — its only text node, an attribute the writer may set, an `<img src>`
  for an upload — is bound to that element as if the attribute had been written
  there. Found nowhere, more than once, partially or split across nodes: nothing
  is bound, and the field stays as unbound as it was.

  Every guess is stamped onto its element as the attributes a template would have
  carried plus `data-payload-guessed` with the value it matched, is listed in
  `inspect().bindings.guessed`, and appears under its own heading in the
  unbound-fields overlay with the attribute to paste. A declared
  `data-payload-field` always wins; `data-payload-no-bind` keeps a subtree out.
  The option is off by default and is accepted by the client, the inline script
  and every adapter (ADR 0014).

  A route refresh keeps the guesses. The refresh morphs the page toward the
  server's markup, which carries no stamp, so the runtime looks for the guesses
  it already made on the fresh markup — by the value each was found by and by the
  field's current value — and for nothing else; a field the first message did not
  bind is not bound by a refresh either.

- 084217a: `livePreviewAnnotate()`: bindings written at build time, bound to the request's authorization.

  ```js
  // astro.config.mjs
  import { livePreviewAnnotate } from 'payload-live-preview/annotate';

  export default defineConfig({
    vite: { plugins: [livePreviewAnnotate({ inventory })] },
  });
  ```

  A template keeps the markup its author wrote — `<h1>{page.title}</h1>` — and the build rewrites it to `<h1 {...__lpPreview.bind('title')}>`, one helper per file, built from `Astro.locals`. The binding therefore exists for a preview the adapter authorized and does not exist for anyone else: the fixture's public response carries no `data-payload-*` at all, while the tokened one carries exactly the fields the template prints.

  What may be annotated is decided by the same scanner as `pll-codegen annotate` and nowhere else, so the two annotate the same places and refuse the same ones. A statically built page has no request to authorize and emits nothing; `allowPublicBindings: true` writes the plain attribute there instead, which is the same disclosure the codemod makes, said out loud.

  Astro only, and for a reason rather than a lack of time: the rewrite needs a template whose own scope can reach the request context. Frontmatter and `Astro.locals` give that; a Svelte or Vue component does not, since the verdict would have to travel through `load` or a serialized payload, where a function cannot go.

  It hooks `load`, not `transform`. Astro compiles `.astro` in a `transform` of its own registered ahead of anything a config contributes, so by the time a user transform runs the markup is already compiled away — measured with a probe plugin, not assumed. `name`, `enforce` and `load` are the whole surface used, all stable since Vite 5, and the majors it is exercised against are read from `quality/compat-matrix.json` rather than typed here.

  New: `payload-live-preview/annotate`, separate from `./codegen` so a build plugin never drags `ts-morph` into a project, and `previewBindingsFromLocals()` on `payload-live-preview/server` — the one-line helper the generated call uses, and useful by hand. `vite` is now an optional peer (`>=5.4.0 <9.0.0`), never a dependency.

- 11dacbf: When the runtime knows a patch cannot reach what the server would have drawn, it
  now asks a server to draw the region instead of leaving the degraded patch on the
  page. Three findings reach that decision:

  - a renderer that refused the value it was handed — an element with structured
    children (LP0402), an upload or image whose value carries no usable URL, an
    array renderer given something that is not one — or a field type with no
    renderer at all;
  - a Lexical block with no registered renderer whose server markup the write had
    to drop because the live and rendered trees do not line up (the case LP0410
    documents as the one it cannot keep);
  - a revision that changes a field with no binding anywhere, which is also how a
    section the template renders only under a condition looks from the page's side.

  Each escalates to the fragment strategy when a boundary covers the binding and
  to the route otherwise, once per element — a page with neither `fragments` nor
  `routeStrategy` has nothing to escalate to and keeps the patch, exactly as
  before.

  **`onUnboundChange` is renamed to `onUnfaithfulPatch`, and its default changes.**
  The new option takes `'ignore' | 'warn' | 'escalate'` and defaults to
  `'escalate'`; `'warn'` reports the new **LP0411** and keeps the patch; `'ignore'`
  keeps it silently, which is what 2.0 did. `onUnboundChange` still works and still
  decides when it is given — `'route'` means `'escalate'`, `'ignore'` means
  `'ignore'` — and is removed in 3.0.

  A page that configured no strategy sees no change. A page that did, and had left
  `onUnboundChange` at its default, will now refresh its route for a change nothing
  binds; `onUnfaithfulPatch: 'ignore'` restores the old behaviour.

- 11dacbf: On a Nuxt page the runtime's first write no longer lands before Vue has
  hydrated. Measured on the example: the runtime wrote the admin's document at
  25 ms, Vue hydrated at 94 ms and repaired every written value back to the
  server's — quietly, with only a development `console.error` — and what put
  them right again was the mock admin answering the runtime's second `ready`;
  Payload's admin answers `ready` once, so on a real page the first document was
  gone until the editor typed.

  Every script the Nuxt adapter emits now declares `hydration: 'vue'` (the
  second value of the inline option ADR 0015 added), and under it the runtime
  does not start until Vue has mounted the app around the bindings — observed
  through the `__vue_app__` property Vue puts on its container as `mount()`
  returns, with no polling and no armed bootstrap — and, on Nuxt, until a
  Suspense still hydrating at the mount has resolved. The cap, `LP0607` (which
  now names the mount it waited for) and `inspect().hydration` (`mode: 'vue'`)
  are the ones React's case has. The addendum to ADR 0015 records the
  measurement, the signals that were not usable and why, and the failure modes.

- 11dacbf: On a Next.js page the runtime's first write no longer lands before React has
  hydrated. Measured on the example: the runtime started on `DOMContentLoaded`,
  the admin answered `ready` at once, and the document was written 81 ms before
  React walked the server markup — React threw `Hydration failed because the
server rendered text didn't match the client`, regenerated the tree on the
  client and dropped the write, once per page load.

  Every script the Next.js adapter emits now declares `hydration: 'react'` — a
  new inline option, wire slot 23, unset everywhere else — and under it the
  runtime does not start (no `ready`, no listener) until React has committed the
  tree that holds the bindings, observed through React's instrumentation hook
  (`__REACT_DEVTOOLS_GLOBAL_HOOK__`, wrapped when a DevTools extension already
  owns it). A page whose React never commits starts after five seconds and
  reports `LP0607`; `inspect().hydration` reads `waiting`, `committed` or
  `timed-out`. Under asset delivery the bootstrap is a build that arms the
  observation before it fetches the runtime, which may otherwise arrive too late
  to be injected into. ADR 0015 records the decision and its failure modes.

- 4893767: `LP0501` is said out loud when a message is refused for coming from the wrong window.

  `eventSourcePolicy` is `'parent-or-opener'` by default since 2.0, where 1.x accepted any window on a trusted origin. An arrangement whose admin posts from somewhere else — a custom integration, a sibling frame, a harness — therefore stops updating on upgrade, and the refusal only ever reached the debug log, which is off in production and in most development. From the outside that looks like "live preview is broken", with nothing to go on.

  It is now reported once per page, naming the option, its 2.0 default and the 1.x behaviour, the same way `LP0503` reports protocol drift. No new code and no behaviour change: the message stays refused, and `eventSourcePolicy: 'any'` restores the old policy.

  This is the second of the three defaults 2.0 flipped in silence; `LP0409` covers the sanitizer. The third, `skipUnchanged`, deliberately gets no report — it skips writes whose value did not change, which is a cost decision rather than a visible one, and `inspect().revisions.skippedUnchanged` counts them.

- ee0a3d7: Hybrid preview (ADR 0011, the fragment protocol and its abuse model): a
  `data-payload-fragment` boundary is rendered by the site's server from the
  unsaved form state and morphed in with focus and visitor state intact.
  `createFragmentEndpoint()` on the Astro entry renders only a registry of
  components, for an authorized preview bound to the page route, from a
  same-origin JSON POST within body-size and time limits;
  `payload-live-preview/fragment` is the browser half
  (`createFragmentStrategy()`), with one revision-bound request per boundary,
  dedupe, a concurrency cap, timeouts and response validation. A failure
  patches the boundary from the same revision and reports `LP0801`–`LP0806`; a
  superseded revision aborts its requests. Adapters take
  `fragments: { endpoint }`; the injected runtime then carries the fragment
  client, and a page without it gets the plain runtime.

  The route strategy refreshes the whole route once per revision for head or
  `data-payload-strategy="route"` bindings — scroll and focus kept, the revision
  re-applied on the fresh markup, a second request refused with `LP0805`.
  Strategies are resolved per binding (explicit attribute, fragment boundary,
  head, patch) and dirty fields are coalesced per boundary and route, the
  `dependencies` registry included. Events gain `fragmentRender` and
  `source: 'patch' | 'fragment' | 'route'`; `inspect().fragments` and
  `inspect().route` report counts. docs/hybrid.md covers the setup.

- 37aca89: Island interoperability. A hydrated island — `astro-island`, or any element
  marked `data-payload-island` — owns its subtree: the runtime does not patch
  bindings inside it and the keyed morph never enters it. Instead every applied
  update is dispatched on each island root as a `payload-live-preview:update`
  DOM event (`ISLAND_EVENT`; `detail: { fields, revision, receivedAt, locale }`)
  for the island's own code to apply; islands on Payload's official
  `useLivePreview` hook need nothing and are left alone.
  `data-payload-island="patch"` opts an island into patching. Proven in three
  browsers.
- 37aca89: Keyed DOM morph for structural updates (ADR 0008, keyed morph: what it keeps,
  what it never crosses). A changed item keeps its live element and is edited
  toward the re-rendered markup, so focus, text selection, typed values, scroll
  position, playback, a visitor-opened `<details>` and the listeners the site
  attached all survive an update. Children pair by `data-payload-key` /
  `data-payload-nested-key`, else by position; `open`, `value`, `checked` and
  `selected` are touched only when the template names them. The morph never
  enters a custom element, `astro-island`, `data-payload-island`,
  `contenteditable` or `data-payload-owned` subtree. Missing, duplicate and
  unstable keys are reported once per container (`LP0404`–`LP0406`) and degrade
  to positional pairing. Item templates may contain form controls, `<details>`,
  media and custom elements (`sanitizeHtml(html, { allowFormControls: true })`,
  used only for author templates — every interpolated value is escaped first).
  Proven in three browsers; the cost against a plain replace is in
  docs/benchmarks.md.
- 11dacbf: A keystroke now reaches the preview in one animation frame instead of after the
  whole `debounceMs` window.

  The debounce exists to coalesce a burst of messages into one write, and the
  first message of a quiet phase is not a burst: it was waiting for a window with
  nothing in it to coalesce. The scheduler now applies that first write on the
  next frame and opens the window from there, so everything the burst brings after
  it is still batched exactly as before. Measured in jsdom against the runtime's
  own interaction gate, one isolated keystroke: **66.6 ms p95 → 16.6 ms p95**, and
  the same on a rich-text and a relationship field.

  This is only worth having because `dataMerge` no longer asks Payload on every
  message: a leading write that had to wait for a REST round trip would be a frame
  plus the network. For the common edit — typing into a text field — there is now
  no request and no window between the keypress and the page.

  Nothing to configure. `debounceMs` keeps its meaning for the burst, and
  `debounceMs: 0` behaves as it always did. A field that only the server can
  resolve still shows what the message carried until the shared answer lands, and
  is replaced when it does.

- 084217a: Add `payload-live-preview/lean`: a smaller runtime artifact for pages that need
  less.

  ```ts
  import { LEAN_RUNTIME } from 'payload-live-preview/lean';

  livePreview({ runtime: LEAN_RUNTIME, allowedOrigins: [ADMIN] });
  ```

  24 763 bytes gzip against the full runtime's 30 253. It leaves out the fragment
  and route strategies, the keyed morph, the structural arrays, the item templates
  and the screen-reader announcer; everything else is the same runtime — the same
  message bus, origin rules, merge and renderers for text, numbers, dates, images,
  uploads, relationships and rich text.

  A page that needs one of the omitted features is told so once, with LP0104, and
  its markup is left exactly as the server rendered it. Never half-applied, never
  silent. The two strategies and the lean artifact exclude each other outright, and
  the generator refuses that combination rather than emitting a prelude with
  nothing to talk to.

  It is an imported value rather than a `profile: 'lean'` option because that is
  what keeps it free for everyone else: measured on this package, a string option
  put the second artifact into every adapter entry and grew each by 24 KB gzip.
  This way the bytes follow the import.

- 37aca89: Conditional and derived markup. `data-payload-depends="price currency"` on a
  binding declares the fields whose change re-applies it under `skipUnchanged`;
  it is parsed by the same module the `dependencies` option uses and merged into
  one map. `data-payload-strategy` names the delivery strategy — `patch`,
  `fragment` or `route`; an unknown name is left unchanged with `LP0407`.
  `data-payload-boundary` marks an empty-field anchor: a stable element for a
  field that may be empty, hidden while empty, shown when filled;
  `PreviewBoundary.astro` (`payload-live-preview/astro/PreviewBoundary.astro`)
  renders it. `data-payload-island` and `data-payload-owned` mark subtrees the
  morph never enters. The Astro `renderLivePreviewScript()` maps its options
  through the shared adapter policy, so `skipUnchanged`, `scopeBindingsByOwner`
  and `defaults` reach the inline runtime too.
- 11dacbf: `dataMerge` now asks Payload only when the answer can change what the page
  shows. Until now every accepted message cost one authenticated POST to the REST
  API: eighteen keystrokes, eighteen requests, and nineteen of them on a page with
  no binding at all.

  Three decisions, in this order (`src/core/merge-need.ts`):

  - **Nothing reads a populated value → no request.** A page with no binding, no
    island, no `data-payload-fragment` boundary and no `beforeUpdate`/`afterUpdate`
    listener has nobody to hand the answer to; so does a page whose every binding
    is a plain scalar renderer on a top-level field. A route refresh is not a
    reason to ask: it re-renders the page from the server and never reads these
    values.
  - **Nothing populated moved → no request.** The fields the editor changed are
    taken from the message and everything else is carried over from what the last
    merge resolved. Typing into a text field costs nothing.
  - **Otherwise one request opens the burst and one closes it.** The rest share
    the request that follows the window, which is the scheduler's `debounceMs`;
    `debounceMs: 0` turns the window off and keeps the two skips. The page never
    waits for a shared request — it renders what it already has, and the answer
    refines it when it lands.

  A field that names a document is never rendered from the bare id the panel posts
  for it: the value the last merge resolved stays on the page until the new one
  arrives.

  What changes for a page that reads no populated value at all: it no longer sees
  values a collection's `afterRead` hooks would have changed on the way back. Bind
  one field through a relationship path (`data-payload-field="venue.title"`) and
  the page merges as before.

- ee0a3d7: Migration tooling for 2.0. `pll migrate <path>` (the codemods live in
  `payload-live-preview/migrate`) rewrites the 1.x → 2.0 renames and moves from
  the renames ledger (ADR 0007, 2.0 defaults, migration policy, and the renames
  ledger): `isPreviewRequest` → `hasPreviewIntent`, the `createPreviewBindings`
  `authorized` option → `authorization`, the root `fetchPreview*` helpers →
  `definePreview()` on `payload-live-preview/server`. It touches only
  identifiers imported from this package and exits `3` when a site needs a
  human. `pll doctor --v2 <url>` reads a served page's inline configuration and
  reports each readiness row the page runs at its 1.x value — referrer trust,
  message source policy, sanitizer policy, `skipUnchanged` — as `LP0709`, each
  with the option that closes it. docs/migration.md walks the `defaults: 'v2'`
  table row by row with before/after examples.
- 084217a: Add the fragment endpoint to the Next.js adapter, and let every adapter point at
  one.

  Server-rendered boundaries existed only for Astro. That was never a limit of the
  endpoint — its authorization, protocol, limits and registry lookup never touched
  a component system — but the only export lived in `payload-live-preview/astro`,
  so a Next.js project had to import the Astro entry and pass its own `render` to
  get a boundary rendered. The endpoint now lives in
  `@adapters/shared/fragment-endpoint`, and each adapter binds a renderer to it in
  a few dozen lines.

  ```ts
  // app/payload/fragment/route.ts
  import { createFragmentEndpoint, defineFragment } from 'payload-live-preview/nextjs';
  import { Hero } from '@/components/Hero';

  export const POST = createFragmentEndpoint({
    authorizePreview,
    registry: {
      hero: defineFragment(Hero, ({ fields }) => ({ title: String(fields.title ?? '') })),
    },
  });
  ```

  `defineFragment()` pairs a component with the props it takes, so a renamed prop
  is a type error in the registry instead of an empty boundary in the preview.
  React renders through `renderToString()`; `react` and `react-dom` are optional
  peers imported at the first render, so a project that registers no fragment
  never loads them — as `astro` already was for the Astro binding.

  The `fragments: { endpoint }` option moves from the Astro adapter's options to
  the shared ones, so the Next.js, SvelteKit and Nuxt adapters accept it too. It
  only names a same-origin path the runtime posts to; which framework serves that
  path is the endpoint's business.

  A render that throws now also logs the boundary's id and the message once per
  process, outside production. The response stays a generic `500 {"error":"render"}`
  — from the browser a component that throws on every request was indistinguishable
  from a network fault, and nothing said which boundary it was.

- 11dacbf: New: **`<LivePreviewScript />`** from `payload-live-preview/nextjs` — a Next.js
  delivery that charges a public visitor nothing.

  Until now a Next.js project put the script in its root layout by spreading
  `livePreviewScriptProps()`. That helper is synchronous, so it cannot wait for an
  authorization verdict and does not try: it builds the script for whoever is
  asking, and a root layout renders for everyone. Measured on a real site, a
  request with no cookie and no preview intent came back with 195 342 of 254 707
  bytes of preview runtime — 77 % of the page. Next renders a layout's `<head>`
  twice, once into the HTML and once more into the RSC flight payload underneath
  it, so the runtime shipped twice as well.

  `<LivePreviewScript />` is an async server component. It runs the same policy
  the middleware runs — preview intent, then `authorizePreview` — and renders
  nothing at all for a request that is not an authorized preview. Not a bootstrap:
  nothing, the same as the Astro middleware, the SvelteKit `handle` and the Nuxt
  Nitro plugin already deliver.

  ```tsx
  // app/layout.tsx
  import { headers } from 'next/headers';
  import { LivePreviewScript } from 'payload-live-preview/nextjs';
  import { authorizePreviewRequest } from 'payload-live-preview/server';

  export default async function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <head>
          <LivePreviewScript
            request={new Request(process.env.SITE_ORIGIN!, { headers: await headers() })}
            inject="always"
            allowedOrigins={[process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!]}
            authorizePreview={(request) =>
              authorizePreviewRequest(request, {
                type: 'payload-session',
                serverURL: process.env.PAYLOAD_URL!,
              })
            }
          />
        </head>
        <body>{children}</body>
      </html>
    );
  }
  ```

  It takes the request as a prop rather than importing `next/headers` itself, the
  same reason `<LivePreviewRouteRefresh />` takes the router's refresh as one:
  `next` is not a dependency of this package. A `Request` is what
  `authorizePreview` and `shouldInject` already receive from the middleware, so one
  options object serves both.

  Next hands a server component the request headers and cookies but not its URL, so
  a layout cannot see `?preview=true` and the default `previewSignals: ['query']`
  cannot fire there. `inject: 'always'` makes the authorization hook the only gate,
  which is the stricter reading anyway; a **page** gets `searchParams` and can pass
  the real URL, which the `signed-token` strategy needs because it binds a token to
  a path. Both recipes are in `docs/nextjs.md`.

  `livePreviewScriptProps()` and `renderLivePreviewScript()` are unchanged and stay:
  the first for a layout that is not gated, the second for HTML a server assembles
  as a string. `delivery: 'asset'` remains the answer for a script built once at
  module scope — a 696-byte bootstrap instead of the runtime. What each choice costs
  a visitor, measured: `docs/deployment.md`.

- 084217a: Add `livePreviewScriptProps()` to the Next.js adapter.

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

- 084217a: Add `onUnboundChange`, so an edit to a field the page does not bind is no longer
  invisible.

  Patching reaches what the markup annotates. Until now a revision that changed a
  field with no `data-payload-field` anywhere did nothing at all: the preview kept
  showing the old value with no sign that anything had happened. A framework hook
  that re-renders the whole component tree has no such failure mode, and that was
  the one thing the official React and Vue packages did better.

  `onUnboundChange: 'route'` refreshes the route for such a revision instead.
  Where a binding exists the page is still patched in place, focus and scroll
  intact; only the change nothing covers costs a refresh. The default stays
  `'ignore'`, so nothing changes for an existing setup.

  A binding on the field, on its locale-suffixed name, or on a path inside it
  (`hero.eyebrow` covers the field `hero`) all count as covered. The fields Payload
  sends with every document are never counted, and the connection's first message
  is skipped — there every field looks changed and the page has just been rendered
  from them. The refresh reports `LP0807`.

- 2820bbb: Authorized preview context (ADR 0006, authorized preview context: threat model
  and authorization strategies). `authorizePreviewRequest(request, strategy)`
  turns a Payload session, a short-lived signed token (`issuePreviewToken`) or a
  consumer-supplied verifier into one branded `AuthorizedPreviewContext`; a
  refusal is an outcome, never an exception. Every adapter accepts
  `authorizePreview`, and a refusal blocks runtime injection, CSP changes and
  nonce exposure regardless of `autoInject` and `shouldInject`.

  `strict` (default `true`) refuses to start without the hook, without explicit
  `https:` `allowedOrigins`, or with referrer trust, rather than gating a
  response on preview intent alone. `defaults: 'v1'` restores intent-only
  gating, which is announced once per process outside production. The runtime
  option `eventSourcePolicy: 'parent-or-opener'` (the default) accepts updates
  only from the window that framed or opened the page; `'any'` is the 1.x
  behavior.

  `hasPreviewIntent()` is the honest name for what the 1.x `isPreviewRequest()`
  did — detect intent, not authorize — and replaces it; `isPreviewRequest()` is
  removed and `pll migrate` rewrites the call sites.

- 422a71b: Protocol capabilities are observed, not assumed (ADR 0010, protocol
  capabilities are observed, and Payload versions sit behind a profile). Each
  capability names the behavior it gates and the fallback without it
  (`CAPABILITY_DECLARATIONS`), and becomes active by an announced protocol
  version or by observation — the stock Payload admin announces no version, so
  the runtime reads what it can do off its messages. `inspect().protocol` gains
  `observed` (the capabilities seen on the wire) and `profile` (`payload-2`,
  `payload-3` or `unknown`). Payload-version-specific behavior sits behind that
  profile: a Payload 2.x admin, recognized by the schema it sends, populates
  relationships itself, so the runtime does not re-merge its data through the
  REST API. A data update that carries `externallyUpdatedRelationship` fires the
  `relationshipUpdate` event and re-renders every bound field even under
  `skipUnchanged`, because a drawer edit changes populated values, not form
  values.
- 084217a: Make protocol drift visible: LP0503 in the browser, and an issue from the weekly
  watch.

  This package mirrors Payload's postMessage protocol by hand and has no `payload`
  dependency, which is what lets it run on Astro, static pages and plain HTML. The
  price is that a newer admin can send something this runtime does not recognise —
  and until now such a message was dropped in silence, which from the outside looks
  exactly like "live preview stopped working".

  Now a message from an origin the page already trusts that misses the expected
  shape, or carries a type this version has no meaning for, prints LP0503 once with
  the origin and which of the two it was. Once per page: a drifting sender repeats
  the same shape on every keystroke, and thirty identical lines would hide the rest
  of the console. An untrusted origin still says nothing — that is a refusal, not
  drift.

  The weekly protocol watch, which executes the published Payload client and
  asserts the behaviours this package relies on, now files what it found as a
  GitHub issue instead of only turning a scheduled run red. It updates the open
  issue rather than opening a second one, and only for the `latest` matrix entry:
  `canary` churns before it stabilises, and an issue per pre-release would train
  everyone to ignore the label.

- 084217a: Add `payload-live-preview/react`: `useLivePreviewDocument()`, the merged document
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

- 3c0f1e1: Renderer API and plugin ownership. Renderers may register under namespaced
  custom keys (`data-payload-type="acme:money"`) without weakening the built-in
  field-type safety — an un-namespaced unknown type still falls back to the
  heuristics. `LivePreviewClient` accepts `resolveRenderer(fieldType, target)`
  for explicit resolution ahead of the registry and `renderRichText` for a
  project rich-text renderer shared with SSR (its output is sanitized, and a
  test pins the equivalence with server rendering). Plugins may declare
  `compat: { runtime, protocol }` and are refused when they do not fit;
  `inspect().plugins` lists every plugin with its state and live registrations.
  The ownership contract — ordering, precedence, duplicates, rollback, async
  destroy, return to baseline over repeated cycles — is under test and
  documented in docs/renderers.md.
- 4893767: The replay store for `signed-token` is one atomic `consume(id, expiresAt)`.

  The 1.x store was two calls, `isUsed` and then `markUsed`, and a review of
  1.8.1 named the consequence: two requests carrying the same token that arrive
  together both pass `isUsed` before either reaches `markUsed`, so the optional
  replay protection did not protect against the one case it exists for. The
  package cannot make two calls one step, so the contract is now one call: the
  store checks and records at once (Redis `SET NX PX`, a unique insert) and
  answers `true` when this use was the first. Any other answer refuses the token
  as `replayed`, a throw as `unavailable`.

  The `isUsed`/`markUsed` shape is still accepted as `PreviewTokenReplayChecks`,
  deprecated with the race stated in its notice, and removed in 3.0. A unit test
  pins both halves: the atomic shape admits exactly one of two simultaneous
  requests, the deprecated one admits both.

- 1d5b302: Reveal the edited section in the preview. With `revealEditedField: true`, when
  a field's value changes the preview scrolls that field's bound element into
  view, so the section under the editor's cursor is visible without manual
  scrolling — the route strategy brings up the right page; this brings up the
  right section. It is conservative by design: it scrolls only when the target
  is off-screen and only when the edited field changes, honors
  `prefers-reduced-motion`, and never fights a deliberate manual scroll. Off by
  default.

  Opt-in admin side: `createPreviewFocusReporter` / `reportPreviewFocus` let a
  Payload field component report the focused field (a
  `payload-live-preview-focus` message), so the preview reveals a field the
  cursor moves into even without typing. docs/reveal.md covers both halves.

- 11dacbf: A route refresh the minimum interval holds back is now run once when the
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

- 084217a: Add `routeStrategy`, so a page can refresh its route without configuring a
  fragment endpoint.

  The route strategy used to arrive only inside the fragment prelude, and the
  generator emitted that prelude only for a page with a `fragmentEndpoint`. A
  binding marked `data-payload-strategy="route"`, or one in `<head>`, therefore
  did nothing outside Astro — the one framework with a `createFragmentEndpoint()`
  helper.

  `generateInlineScript({ routeStrategy: true })` and the same option on every
  adapter now emit a second, smaller prelude carrying the route strategy alone:
  2 068 bytes gzip against the fragment prelude's 3 791. Setting both is not a
  double cost — `fragmentEndpoint` wins, because its prelude already contains the
  route strategy.

  A page that sets neither is unchanged apart from 36 bytes gzip: the runtime now
  looks for the second prelude as well.

- 37aca89: Sanitizer policy and Trusted Types. `sanitizerPolicy: 'strict'`, the default,
  strips `id` and `name` (DOM clobbering), strips `data-payload-*` (rich text
  must never add a binding) and passes other `data-*` only when listed in
  `allowedDataAttributes`; `'compat'` is the 1.x behavior and comes back with
  `defaults: 'v1'`. Every sanitizer case in the property suite runs under both
  policies, and mutation-XSS, namespace-transition, malformed-`srcset`,
  clobbering and extension-collision vectors are pinned.

  Every HTML sink — the sanitizer's own parse and each renderer write — goes
  through one Trusted Types policy named `payload-live-preview`
  (`TRUSTED_TYPES_POLICY_NAME`) where the API exists; a site enforcing
  `require-trusted-types-for 'script'` lists that name or hands in its own
  policy with `setTrustedTypesPolicy()`.

- 084217a: `LP0409`: the strict sanitizer now says what it removed.

  `sanitizerPolicy` defaults to `'strict'` since 2.0; the 1.x default was `'compat'`, which let `id`, `name` and every `data-*` through. The difference only appears when a binding _writes_ markup, so an upgraded project loses its own hooks at the moment an editor types — in the preview, silently, with nothing in any log. Found by upgrading a real 1.8.1 site: a `data-*` attribute driving a CSS selector disappeared on the first write.

  The removal stays — it is a security decision, and the migration guide has always documented it. What is new is that it is said, once per attribute name, with the reason that applies to that name: `id` and `name` because content that can name an element can shadow a global of that name; `data-payload-*` because a binding inside CMS content would let an editor aim a write at any element on the page; every other `data-*` with the two ways to keep it — `allowedDataAttributes`, or `sanitizerPolicy: 'compat'` for the 1.x behaviour.

  Costs ~130 B gzip in every bundle that carries the runtime, the lean profile included. It buys the one 2.0 change an upgrading project could otherwise only discover by looking at the page.

- 11dacbf: The runtime says so when it writes a different reading of a date, a number or
  a checkbox than the template printed. On the first write to such a binding —
  and only when it carries no `data-payload-format` — the preview holds what the
  element showed against what it is about to show, and reports `LP0412` once if
  they differ, naming both readings.

  It is a diagnostic and nothing else: the value is still written, no strategy is
  asked for a re-render, and a page under `onUnfaithfulPatch: 'ignore'` hears
  nothing. There is no way for the runtime to tell "the template formatted this
  differently" from "the field was edited before the preview connected", so the
  message names both and points at the one attribute that settles either.

- 3c0f1e1: `payload-live-preview/server` is the privileged, server-only surface.
  `definePreview({ serverURL, depth })` binds the Payload origin and **one**
  population depth shared by the initial read and the runtime merge
  (`runtimeOptions` spreads into any adapter). Its `fetchDocument()` /
  `fetchGlobal()` take the authorization — or `null` — as the explicit draft
  decision, accept an `AbortSignal`, time out, and report failure as a typed
  result, or throw `PreviewFetchError` under `errorMode: 'throw'`;
  `onDiagnostic` receives every failure for logs. The subpath re-exports
  `authorizePreviewRequest`, `issuePreviewToken`, `hasPreviewIntent` and the
  binding helpers, so a server file imports one thing, and no browser bundle can
  reach it.

  The root-entry `fetchPreviewDocument()` / `fetchPreviewGlobal()` are removed;
  `pll migrate` rewrites each call to `definePreview()`.

- 1391439: New option `skipUnchanged`, on by default: a binding whose value is
  structurally identical to the one it last applied is not scheduled again.

  Every message from the admin carries the whole document, so on a page with
  many bindings almost every value in a keystroke is unchanged, and rendering it
  again costs a Lexical pass and a sanitizer pass for nothing. The comparison is
  canonical JSON, so a fresh object graph per message still matches; a value
  that cannot be given an identity is always applied; a binding on an element
  the cache has not written before is always applied; and a write the renderer
  refused is not remembered, so the next identical message applies it.

  `dependencies` names fields whose change must re-apply other bindings whatever
  their own value did — `{ price: ['priceLabel'] }`. It is consulted only with
  `skipUnchanged`.

  Renderers and `elementUpdate` listeners stop seeing repeats, which is
  observable: `defaults: 'v1'` or `skipUnchanged: false` restores the 1.x
  behavior. `inspect().revisions.skippedUnchanged` counts the skips. Available
  on the client, the inline runtime and every adapter; what a keystroke costs
  with and without it is in docs/benchmarks.md.

- 084217a: Add the fragment endpoint to the SvelteKit and Nuxt adapters, and a gated
  `boundary()` helper for the markup that marks one.

  Server-rendered boundaries now exist for every framework this package adapts.
  The endpoint itself is the same code as before — authorization, protocol,
  limits, registry — and each adapter binds one renderer to it:

  | Framework | Import                           | Renders with          |
  | --------- | -------------------------------- | --------------------- |
  | Astro     | `payload-live-preview/astro`     | `astro/container`     |
  | Next.js   | `payload-live-preview/nextjs`    | `react-dom/server`    |
  | SvelteKit | `payload-live-preview/sveltekit` | `svelte/server`       |
  | Nuxt      | `payload-live-preview/nuxt`      | `vue/server-renderer` |

  ```ts
  // src/routes/payload/fragment/+server.ts
  export const POST = createFragmentEndpoint({
    authorizePreview,
    registry: { hero: { component: Hero, props: ({ fields }) => heroProps(fields) } },
  });
  ```

  `svelte` and `vue` join `astro`, `react` and `react-dom` as optional peers,
  imported at the first render. Nuxt's binding takes a `Request` — what
  `toWebRequest(event)` makes of an H3 event — so this package needs no `h3`
  dependency to describe its own signature. Svelte's binding delivers `render()`'s
  `body` only: `<svelte:head>` output belongs to the document head, which the route
  strategy owns.

  `createPreviewBindings().boundary('hero', { dependsOn: ['title'] })` writes the
  boundary attributes under the same authorization gate as `bind()` — a registry id
  and the fields it depends on describe the content model as much as a field name
  does — and refuses an id the endpoint would refuse, instead of leaving a boundary
  that silently never renders.

  Two notes the guides now carry, both learned from the fixtures: Svelte's server
  renderer keeps its component context in a module variable, so the binding imports
  `svelte/server` by name and the consumer's bundler resolves it in the same graph
  as the components; and Nitro's rollup needs `@vitejs/plugin-vue` to read a
  single-file component inside the server bundle.

- 33ae375: Four focused package entries join `payload-live-preview/core` and
  `payload-live-preview/server`: `payload-live-preview/client` (the
  `LivePreviewClient` and `initLivePreview()`), `payload-live-preview/structural`
  (the structural array renderer, the keyed morph and the dependency helpers),
  `payload-live-preview/lexical` (the Lexical renderer and its registries) and
  `payload-live-preview/plugins` (the plugin manager, plugin types and the
  built-in plugins). Each ships ESM and CommonJS with self-contained
  declarations and its own API report, and is verified from the packed tarball.
  The root barrel is unchanged (ADR 0012, package topology and delivery
  profiles).
- 084217a: Add `createUnboundFieldsOverlayPlugin()`: a development overlay that lists the
  fields an update carried and the page has nowhere to put.

  ```ts
  import { createUnboundFieldsOverlayPlugin } from 'payload-live-preview/plugins';

  void client.use(createUnboundFieldsOverlayPlugin());
  ```

  Annotating a template is the work this package asks for, and the hard part is
  knowing what is still missing. `inspect().bindings.orphanFields` answers that in
  the console — the wrong place while you are editing markup. The overlay puts the
  same answer in the preview, and a click copies `data-payload-field="…"` for the
  field you picked.

  It recomputes on every update from the message's own fields and the bindings
  currently in the DOM, so entries disappear as you save the file that binds them.
  The rule for "covered" is the runtime's own: the fields Payload sends with every
  document never appear, a locale-suffixed name counts, and a binding on a path
  inside a field — `hero.eyebrow` for `hero` — covers it.

  It mounts only when the client runs with `debug: true`, and it is a plugin rather
  than part of the runtime so that no page carries a development tool it did not
  ask for: the inline script's byte budget is unchanged by it.

- 11dacbf: The line about a Lexical block with no renderer now says what happened to it,
  not what was meant to happen. `LP0410` used to be reported while the block was
  being rendered — before the write knew whether the server's markup for it could
  be kept — so on a page where the pairing failed the console said "keeping what
  the server rendered" while the image was being deleted. The write speaks now,
  after the fact, in two texts: `LP0410` when the server's markup stands, and the
  new `LP0413` when it is gone. The second is also the finding `onUnfaithfulPatch`
  acts on, so a fragment or route strategy redraws the region where the page has
  one.

  `inspect()` gains a `fidelity` section: `{ mode, unfaithful, escalated, fields }`.
  `unfaithful` counts every binding the runtime knew it could not patch faithfully
  (once per element, under every mode, `'ignore'` included), `escalated` how many
  of those a strategy was handed. A positive `unfaithful` beside `escalated: 0`
  and `route.handler: false` is the reading a page with a degraded preview and no
  strategy shows — three facts that were not visible from the outside before.

  `lexicalToHtml()` no longer writes to the console for such a block. Its options
  take an `onUnrenderedBlock(blockType, placeholderClass)` listener instead, and
  `RenderNodeContext` carries it to the node renderers; a custom node renderer
  that wraps blocks passes it on by rendering through `ctx.renderChildren`, as
  before.

- 084217a: Add `data-payload-format`, so a bound date or number can be written the way the
  page writes it.

  Until now a bound date was always a localised date and time, and a bound number
  always the locale's plain grouping. A template that shows `17 October 2026` or
  `€12.00` therefore had to leave those fields unbound — and an unbound field is
  one an editor changes without seeing anything happen.

  ```astro
  <time data-payload-field="startsAt" data-payload-format="date:long">17 October 2026</time>
  <span data-payload-field="price" data-payload-format="currency:EUR">€12.00</span>
  ```

  The vocabulary is closed — `date`, `date:short|medium|long|full`, `time`,
  `datetime`, `number`, `number:0-4`, `currency:XXX`, `percent` — because anything
  a page could pass beyond it would be code running inside the preview. An unknown
  value reports `LP0408` once for that element and keeps the default formatting.

  No relative form ("in 3 days"): choosing the unit and its rounding is policy
  rather than formatting.

- 084217a: Add `payload-live-preview/vue`: the same merged document as a composable.

  ```vue
  <script setup lang="ts">
  import { useLivePreviewDocument } from 'payload-live-preview/vue';

  const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
    serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
    allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_URL],
    initialData: props.page,
    depth: 1,
  });
  </script>
  ```

  It is the React hook's session with Vue's reactivity on top — the four returned
  values are refs — so the five differences from `@payloadcms/live-preview` hold
  here too: a trailing slash on `serverURL` still merges, a slow response never
  overwrites a newer one, a failed request keeps the last good document, an HTTP
  error body never becomes the document, and two composables on one page have two
  caches.

  Call it from `setup()` or inside an `effectScope()`. The subscription is released
  with that scope; a call without one throws instead of leaking a window listener
  and a request in flight for the life of the page.

  `vue` is an optional peer, imported by this entry alone. With the SvelteKit and
  Nuxt fragment endpoints and the React hook, the package now covers both official
  live-preview packages and every framework it adapts.

- 084217a: Setup in one line per framework.

  `payload-live-preview/nuxt-module` is a Nuxt module: add it to `modules` and write the options under `livePreview` in `nuxt.config.ts`. It generates the Nitro plugin you would otherwise have written into `.nuxt/` and registers it, so the generated file stays readable as the hand-written setup it replaces. Options are serialized into it, which is why `authorizePreview` and `shouldInject` are not part of the module's option type — a preview that needs either still registers `livePreviewNitroPlugin()` by hand.

  `withLivePreview(nextConfig, { allowedOrigins })` from `payload-live-preview/nextjs` writes what only `next.config.ts` can give a preview: `private, no-store` on requests carrying preview intent, appended to an existing `headers()` rather than replacing it, plus the admin host in `allowedDevOrigins`. It writes no CSP — a config rule cannot run `authorizePreview` — so `frame-ancestors` for the admin origin comes from `createLivePreviewMiddleware`.

  SvelteKit needed nothing: `livePreviewHandle` is already a single export in `hooks.server.ts`.

### Patch Changes

- 422a71b: The Nuxt adapter accepts `shouldInject`, like the other three. One behavioral
  suite drives all four adapters through the same cases — injection on preview
  intent, CSP modes, the one-nonce rule, authorization refusal — which is how
  the gap was found.
- bbd8195: The Next.js, SvelteKit, Nuxt and Astro adapters share one preview policy for
  intent detection, injection, CSP and nonce handling instead of carrying four
  copies of it. Behavior, options and public exports are unchanged;
  `shouldInject` is consulted only once preview intent is established.
- 084217a: Docs: one page that says what the package is, and a reason beside every option.

  `docs/architecture/overview.md` is the map the decision records never had: two screens and the one message that crosses between them, the five objects that answer the two hard questions — the decision, the authorization, the binding, the strategy, the runtime — the three strategies with when each is the right one, and one line of justification for every rule the records expand on, each linked to its record. `docs/options.md` gains the same treatment from the other side: the forty-five rows are grouped into the eight decisions they actually represent, so the table reads as eight questions rather than a list.

  Two types are gone, both concepts with no remaining reason: `PreviewBindingsCommonOptions`, a one-member base left behind when its sibling options type was removed in 2.0, and `AnnotatableEntry`, which had one member and one use. The public surface is five declarations smaller than before this pass.

- d2c5250: An array row that does not carry one of the template's fields renders that
  placeholder as nothing, instead of printing `{{field}}` into the page. Adding a
  row and not filling every field is the normal first second of editing one, and
  until now the editor watched template syntax appear in the preview. A
  placeholder that _no_ row can fill is still written out: that one is a typo in
  the template, and hiding it would hide the mistake.
- 084217a: Lead the documentation with the boundary, not the field binding.

  On a server-rendered page one attribute per component is enough: the region is
  rendered again from the unsaved form state, so conditional sections and derived
  values stay correct without naming a single field. The docs led with per-field
  annotation instead, which made the package look like more work than it is —
  three lines against twelve for the same component, and the twelve-line version
  still misses the section that only exists when a field is set.

  `bindings.md` now opens with the choice and what each option costs: a boundary
  needs a server at request time and the fragment endpoint; field bindings work on
  a static build and keep focus and the caret where a re-render would not — which
  is why both together, boundary for the component and bindings for the fields
  being edited, is the normal case rather than a compromise. `README.md`,
  `astro.md` and `hybrid.md` follow the same order.

  No behaviour changes; every attribute in the docs already existed.

- dca7a18: `pll-codegen` names the missing optional peer instead of failing with a
  module-resolution stack trace. `ts-morph` reads a Payload config, and nothing
  else in the tool needs a TypeScript compiler, so it is now loaded on first use:
  `pll-codegen --help`, `pll-codegen annotate --help` and a usage error all answer
  without it, and a run that does need the schema exits 1 with
  `pll-codegen needs ts-morph: npm install --save-dev ts-morph` — the sentence
  `pll migrate` already printed for the same peer.
- f350cfe: `withLivePreview()` no longer writes a `Content-Security-Policy` header.

  A `next.config` header rule cannot run `authorizePreview`, so it could never be
  where a privileged response change is decided. It could not widen
  `frame-ancestors` safely either: Next collects every matching rule into one
  object keyed by header name and applies it with `setHeader`, and this package's
  rules are appended after yours, so the policy it wrote replaced the one your
  site already sends. Measured on Next.js 16.3.4: a site whose own rule sends
  `frame-ancestors 'none'` answered a bare, unauthenticated `/?preview=true` with
  `frame-ancestors 'self' <admin>` and nothing else — its `script-src` and every
  other directive gone, for anyone who appends the query parameter.

  `frame-ancestors` for the admin origin comes from `createLivePreviewMiddleware()`,
  which merges into an existing policy and only for a request the policy engine
  authorized. The rule still marks an intent-bearing request `private, no-store`,
  and `withLivePreview()` still adds the admin host to `allowedDevOrigins`.

- dca7a18: `pll doctor` no longer reports `X-Frame-Options: SAMEORIGIN` as an error when it
  was not told which origin embeds the preview. The header refuses a frame from
  another origin; where the admin and the site share one, the preview runs, and
  calling that an error made the audit fail a deployment with nothing wrong with
  it.

  **If you gate CI on the exit code, read this:** an anonymous probe of a page
  serving `SAMEORIGIN` — `pll doctor <url>` with no `--admin` — now ends with
  exit 0 and a warning, where it ended with exit 2 and an error. Nothing else
  moves: with `--admin` a shared origin was already silent and a foreign one is
  still an error, and `DENY` stays an error in every case, because no origin
  makes it harmless. The warning names the condition and asks for `--admin` so
  the next run can decide.

- 4f1f829: The doctor's line about a script without a defaults marker named 2.0.0-rc.0, a
  version that was never published: Changesets carries the beta's number on when
  the pre tag changes, so the first candidate is rc.1, and rc.1 is where the
  marker shipped. The reader of that line is someone deciding whether their page
  is old enough to explain a warning, so the number has to be one they can find.
- 1af4696: `pll doctor --v2` no longer reports four readiness gaps on every 2.0 page. It read an empty slot of the inline configuration as the 1.x value, while the 2.0 runtime runs the 2.0 one. The inline script now names the defaults it was generated against, and the doctor reads that instead of guessing; a script without it — from 1.x or `2.0.0-beta.0` — is still read as 1.x, and the report says so.

  `generateInlineScript({ defaults: 'v1' })` restores the 1.x runtime rows, as documented. It wrote the same configuration as the 2.0 default before, so a page built by hand ran the strict sanitizer, skipped unchanged bindings, accepted only its parent or opener and ignored the referrer, although it had asked for 1.x. The adapters resolved the profile themselves and were not affected.

- d975582: A drawer edit reaches the page even when the panel supersedes the message that
  carried it.

  Payload posts `externallyUpdatedRelationship` twice for one drawer save, back to
  back. The runtime reads the event as an edge, so it is news on the first of the
  two messages: that revision forces the re-render and asks the server for the
  populated document. The second message is the repeat — it forces nothing and
  asks nothing — and it supersedes the first before the answer arrives. The
  populated document was then dropped with the revision that ordered it, and the
  page kept the values from before the drawer was opened.

  Measured against Payload 3.88 with `mergeDepth: 1` and a global whose `author`
  points at another collection: three revisions accepted, one superseded, two
  requests sent, and every write on the page belonged to the repeat and carried
  the old name; the answer to the second request had the new one. The obligation
  to render now passes from a superseded revision to the one that supersedes it,
  and stops at the revision that completes — so the repeat asks, and the name the
  editor just typed lands. `relationshipUpdate` still fires once per drawer save.

- ca056c1: `inspect().fidelity` now counts the third cause it always named: a changed field
  the page has no binding for at all.

  `onUnfaithfulPatch` acts on three causes — a value no renderer can represent, a
  Lexical block whose markup the write has to drop, and a changed field with no
  binding anywhere. Only the first two reached the ledger: they name an element,
  and the counter was reached from the write. The third is decided one step
  earlier, where there is no element to write to, so a page that binds `title` and
  is sent an edited `tagline` refreshed its route (`LP0807`) and still reported
  `{ unfaithful: 0, escalated: 0, fields: [] }` — under every mode, and on a page
  with no strategy at all, which is the page the reading exists for.

  The finding is now recorded once per field name, under every mode and whether or
  not anything can be done about it, and `escalated` counts the ones a route
  refresh answered. Nothing else moves: `'warn'` still adds no line of its own
  (`LP0201` already names the field), `'ignore'` still keeps the stale value, and
  the default still refreshes the route exactly where it did before.

- ca056c1: The fragment endpoint answers a body it could not parse with `400 shape`
  instead of `413 body`.

  `readBody()` returned `null` both for a body over the 64 KiB limit and for one
  that is not JSON, and the caller turned every `null` into "413 Payload Too
  Large" — so eight bytes of `not json`, an empty body and a truncated object all
  came back as too large, on all four adapters, while `123` and `{"a":1}`
  correctly came back as the wrong shape. The refusal was right and its reason was
  wrong, which for a deliberately generic refusal is the one failure that costs a
  reader time.

  Both statuses and both words were already in the abuse model (ADR 0011 §4): a
  refusal still carries a status and one generic word, never a reason. What is
  accepted does not change, and the fragment client is unaffected — it maps every
  refusal but 401/403 to `LP0801`, whatever the status.

- d975582: A fragment that falls back to a patch now says so on the debug log, not only on
  the `error` event.

  `LP0801` is documented as a code that appears in log output _and_ on the `error`
  event, and `debug: true` is how a page asks to see it. It never appeared:
  `context.failed(...)` emitted the two events and logged nothing, and the one
  `deps.log(…, 'LP0801', …)` in the strategy runner sat in the `catch` around the
  strategy's `render()` — a path the supplied fragment strategy never takes,
  because it answers a timeout, an invalid response or a refusal with an outcome
  instead of throwing. Measured with a 60 ms timeout against an endpoint that
  never answers: `inspect().fragments.failed` 1, an error event carrying LP0801,
  and not one line in the runtime's log sink or on `console.debug`.

  The line is written where the failure happens, so LP0801, LP0802 and LP0803 each
  reach the log with the boundary and the reason they belong to.

- 33ae375: Compatibility claims are what the tests run. The README compatibility table is
  rendered from the framework versions the fixtures install, and a check fails
  when the table, a fixture lockfile or the test matrix disagree. The
  Astro-served browser specs run on Astro 4, 5, 6 and 7, which is the evidence
  behind the `>=4 <8` peer range (ADR 0009, the Astro peer range is what CI
  runs). The built adapters and the server entry also execute inside a
  Web-platform-only context — no `process`, `Buffer` or `node:` modules — so
  edge compatibility is a passing test rather than a claim.
- d975582: LP0408 now says what it does: an unknown `data-payload-format` leaves the
  renderer's default formatting in place rather than writing the value unformatted.

  `data-payload-format="bogus"` on a number binding writes `4,200`, not `4200` —
  the renderer's own `Intl` default, because an unrecognised spec only means "no
  options from the attribute". The sentence in the code, the generated diagnostic
  table, the binding guide and the warning the runtime prints all said
  "unformatted". Only the words change; the formatting itself is unchanged.

- 33ae375: The keyed morph no longer moves a retained element to step around
  whitespace-only text nodes the template does not render. Markup that keeps
  its source indentation between elements — Astro 4–6, and most SSR output —
  made the morph re-insert a focused `<input>`, which blurred it and dropped the
  selection.
- 084217a: Fix: a Nuxt production build rewrote the embedded runtime.

  Nitro's rollup replaces `typeof window` with `"undefined"` everywhere in a bundle — string literals included (`@rollup/plugin-replace` with no notion of code versus data). The runtime travels as exactly such a literal, so a `nuxt build` came out with all six occurrences rewritten: every `typeof window` guard in the runtime inverted, and bytes that no longer matched the integrity hash computed over them. `nuxt dev` externalizes the package, which is why the E2E suite never saw it; mounting the new asset route did, as a failing SRI check.

  The generated constants are now emitted as chunks split inside each such token and joined at load (`scripts/serialize-source.ts`). The value is identical and the cost is a few bytes; `.join('')` rather than `+` because esbuild and terser both fold `"a" + "b"` back into one literal and hand the token straight to the next bundler. `process.env`, `import.meta` and `globalThis.process` are treated the same way, and a test asserts no generated file carries one of them whole.

- df911f1: One name and one shape per option, across the adapters, the intent detector
  and the fragment endpoint:

  - `hasPreviewIntent()` takes `allowedOrigins`, the name the adapters, the
    client, the inline config and `pll doctor` use. `adminOrigins` is a
    deprecated alias, removed in 3.0; `allowedOrigins` wins when both are given.
  - `createFragmentEndpoint()` accepts `authorizePreview` — the page
    middleware's hook, with the same callback type and the same rules (a context
    from `authorizePreviewRequest()` authorizes, any other outcome refuses, a
    configuration error propagates) — called with the page request the fragment
    belongs to. `authorize` still takes a strategy; giving both throws at
    construction, naming both.
  - `LivePreviewLocals`, exported from `./astro`, `./sveltekit` and `./nuxt`,
    types what the adapters publish on `Astro.locals`, `event.locals` and
    `event.context` (`livePreviewNonce`, `livePreviewAuthorization`,
    `livePreviewAuthorizationOutcome`). The adapters write through it, so
    `interface Locals extends LivePreviewLocals {}` cannot drift from the code.

- ffb6631: Every release installs the published package from the registry and imports
  every subpath a Node consumer can reach, immediately after publishing.

  Everything before that step reasons about the tarball the release built. This
  proves the artifact the registry serves: installed by a plain `npm install`
  into a directory with no workspace, no lockfile and no local build to fall
  back on, with the optional `ts-morph` peer present so the codegen and migrate
  entries are exercised rather than failing on a missing package. A release
  could otherwise be green end to end and still leave an uninstallable package —
  a file missing from `files`, an export map resolving to nothing, a dependency
  that only existed locally. A subpath added to the package and not to that
  check fails the release rather than going untested.

- 084217a: Docs: what a public visitor actually pays, per delivery, held by tests.

  `docs/deployment.md` gains a table with three outcomes rather than one claim: a setup that decides per request (SvelteKit handle, Nuxt Nitro plugin, Astro middleware) sends a visitor neither runtime nor bootstrap; a statically built Astro site in `mode: 'loader'` and a Next.js layout with `delivery: 'asset'` send the 679-byte bootstrap, which fetches nothing outside a preview; a Next.js layout with the inlined script and an Astro `mode: 'inline'` build send the whole runtime to everyone.

  Every row is pinned by a case in `tests/e2e/specs/public-response.spec.ts`, against the fixture it describes, so the table cannot drift from what the adapters do. Two further cases hold the claims underneath it: the gap between the same page inline and on asset delivery is the runtime, and a request that claims `?preview=true` without passing `authorizePreview` gets the public response byte for byte.

  No behaviour changed. The sentence "a visitor pays nothing" was true of some setups and not others, and now says which.

- 11dacbf: `externallyUpdatedRelationship` is read as an event, not as a flag. Payload's
  panel fills the field from `useDocumentEvents().mostRecentUpdate` — a state that
  every save of the previewed document raises and that nothing ever clears — so
  from the first save on, every message carried it. The runtime read each one as a
  fresh drawer edit: `skipUnchanged` was off for the rest of the session, every
  binding was rewritten on every keystroke, and `relationshipUpdate` fired once per
  keystroke with an event that named the previewed document itself.

  The update now re-renders, and the event now fires, only when the document event
  changed since the last message _and_ names a document other than the one on the
  page. A message that does not say which document it previews still takes the
  event at its word — once. Replaying the recorded Payload 3.88 session
  (`tests/fixtures/wire-corpus/payload-3.88.0.json`, which crosses a save): four
  `relationshipUpdate` events become none, and the writes after the save go from
  none skipped to thirteen.

- 11dacbf: A Lexical block with no registered renderer survives an edit on a page whose
  template wraps the rich text in a `<div class="prose">` — the usual Tailwind
  shape, and the shape the block-keeping write could not see. The write paired
  the bound element's children with the rendered document's positionally, and a
  wrapper is one child where the document has many, so the pairing stopped and
  the empty placeholder was written over the server's `<figure>` after all:
  measured on a Payload 3.88 post, one image and 1 272 characters before an edit
  to the _title_, none and 501 after.

  The write now pairs inside the wrapper and writes into it, so the wrapper — and
  the classes the typography hangs on — stays as well. A wrapper is the bound
  element's only child, a `div`, `section` or `article`, without a binding of its
  own, standing where the rendered document has several elements and unlike every
  one of them; a `<div>` a registered block renders is content, and a paragraph
  typed after it is written beside it, not into it.

- 084217a: Fix: on Vite 8, importing one helper from the root barrel shipped the whole package.

  Vite 8 bundles with Rolldown instead of Rollup. The runtime source is emitted as chunks joined at load, and Rolldown would not prove that call pure, so it kept the array and everything reachable from it: `import { escapeHtml } from 'payload-live-preview'` came out at 32 512 bytes gzip instead of 220. Rollup had dropped it either way, which is why the tree-shaking gate — pinned to Vite 7 — never saw it.

  The expression is annotated `/* @__PURE__ */` now, which both esbuild and terser preserve: the same import is 2 378 bytes gzip on Vite 8 and unchanged on Vite 7. The focused entries (`payload-live-preview/lexical`, `/structural`, `/core`, `/react`, `/vue`, `/plugins`, `/lean`) were never affected and stay within a few percent of their Rollup figures.

  The tree-shaking gate runs on Vite 8 from now on, because that is what Astro 7 and Nuxt install. Every budget in it was re-measured against Rolldown, which is less precise than Rollup at dropping unused declarations out of a bundled module — the numbers moved, the package did not.

- df911f1: The sanitizer policy is per client instance. `sanitizerPolicy` — from the
  client configuration or the inline script — travels with its runtime into
  every renderer's `RenderContext` (`context.sanitizerPolicy`), so two clients
  on one page each sanitize with their own policy, and constructing one no
  longer changes what the other renders. `setSanitizerPolicy()` remains the
  process-wide default for code that calls `sanitizeHtml()` directly, and the
  fallback for a render context without a policy.
- 4893767: The strict-mode refusals name the staged path.

  `strict` is the default since 2.0, and its three startup errors — a missing `authorizePreview`, an empty `allowedOrigins`, a non-https admin origin in production — stop a process that worked on 1.x. Each stated its rule and nothing else, which left an upgrader to discover on their own that a staged path exists.

  They now end with it: `defaults: 'v1'` keeps the 1.x table while you migrate, and `docs/migration.md` has the rest. The rules are unchanged; the way out is in the message that stops you rather than only in a guide you have not opened yet.

  Together with `LP0409` and `LP0501`, this closes the three shapes a 1.x project meets on upgrade: an option whose default flipped in silence, a message quietly refused, and a process that refuses to start.

- 084217a: `livePreviewHandle` composes with SvelteKit's own `Handle` type.

  The returned handle declared a fixed shim for the request event, which worked
  one way only: SvelteKit's real `RequestEvent` is assignable to the shim, but its
  `resolve` — which takes that real event — is not assignable to a resolve that
  takes the shim. Wrapping the handle in one of your own therefore failed to
  compile even though every value matched. It is generic in the event now, and the
  event passes through untouched.

  The adapters also declare what they write to a framework's request context
  (`LivePreviewLocalsSink`) instead of `Record<string, unknown>`: an `App.Locals`
  interface has no index signature, so it was not assignable to a record.

- 33ae375: The root barrel tree-shakes. Importing one symbol from `payload-live-preview`
  ships that symbol, not the whole bundle, because the three things that
  defeated a consumer's bundler are gone: esbuild's `keepNames`, whose helper
  statements cannot be proven pure (name preservation moved to the terser pass
  with the same public allow-list, so `fn.name` on exported classes and
  functions is unchanged); minification in esbuild, which stripped the
  `/* @__PURE__ */` annotations Rollup relies on; and three import-time side
  effects in the library itself (the built-in renderer table, Lexical node
  registration, an eager `TextEncoder`). A test bundles one-symbol consumers
  with Vite against the built package; what one import costs is in
  docs/benchmarks.md. Bundles are 6–7 % smaller as a side effect; the inline
  runtime is unchanged.
- df911f1: Polish from the 2.0 readiness pass.

  - `CachedElement.boundary` is renamed `hidesWhenEmpty`: the flag marks a
    `data-payload-boundary` empty-field anchor that hides itself while its field
    is empty, and the old name read like a fragment boundary. Only a custom
    renderer that inspected the flag is affected; TypeScript reports the old
    name.
  - Constructing a client without a document fails at once with a message that
    names the `root` option, instead of a `TypeError` on the first DOM read in
    `start()`.
  - A route refresh that outlives its timeout is logged as a timeout
    (`LP0801 route refresh timed out after N ms`), not as the browser's
    `AbortError` text.
  - The per-template sanitizer options cache is bounded (64 entries, least
    recently used evicted).
  - `defaults: 'v1'` on `LivePreviewClient` fills every 1.x row
    (`sanitizerPolicy: 'compat'`, `skipUnchanged: false`, referrer detection on,
    any event source). Before this fix the client left the config alone and fell
    through to the runtime's own fallbacks, which are the 2.0 values, so a v1
    client without explicit values sanitized strictly. The inline script was not
    affected: the adapters put the v1 rows on the wire.

- 11dacbf: A Lexical block with no registered renderer no longer deletes the markup the
  server rendered for it. `lexicalToHtml()` renders such a block as an empty
  `<div class="lp-block lp-block--<slug>">`, and until now the `richText` write
  put that empty element on the page over the `<figure><img></figure>` a project's
  own server had already produced for the same block — measured on a Payload 3.88
  post: 1 286 characters and one image before the patch, 501 and none after,
  triggered by an edit to the _title_.

  The write now pairs each placeholder with the element standing in its position
  in the live markup and leaves that element where it is, so the rest of the
  document is written and the block survives. Pairing is positional — the server
  writes no id to match on — and stops where the child counts disagree; then the
  placeholder is written after all, exactly as before.

  New diagnostic **LP0410**, once per block type: `no renderer for block "x";
keeping what the server rendered for it.` Register one with
  `registerBlockRenderer()` (or `registerDefaultBlocks()`) to render it in the
  browser too.

- 084217a: A 1.x project compiles against 2.0 without an edit.

  Measured against the published 1.8.1 declarations rather than assumed, and entry by entry rather than at the root alone: of the 114 names the root entry exported, eight are absent from 2.0, and `./astro` lost four of its own. Seven of those moved behind `definePreview()` or changed shape — `fetchPreviewDocument()`, `fetchPreviewGlobal()` and their option types, and `CAPABILITY_REQUIREMENTS`. One was a plain rename, and that one is back on **both** entries that exported it: `isPreviewRequest` is a deprecated alias of `hasPreviewIntent`, removed in 3.0, so the most common 1.x import keeps working and an editor names the successor at the call site. `./astro` also regained `PreviewSignal`, which 2.0 had stopped re-exporting although the type still exists.

  What is deliberately not aliased is everything whose _meaning_ changed rather than its name: the fetch helpers (`depth` was defaulted independently of the runtime's `mergeDepth`), `CAPABILITY_REQUIREMENTS` (a version map became a declaration table) and `NextMiddleware` (the middleware takes a response now). An alias there would type something the package no longer produces; TypeScript names each of them at the call site instead, and `docs/migration.md` says what to use. The fetch helpers deliberately have no alias: they defaulted `depth` to `1` independently of the runtime's `mergeDepth`, and a shim would restore the mismatch the move exists to remove.

  Verified on a real 1.8.1 consumer, upgraded untouched: 201 Astro files, **0 errors**, two deprecation hints pointing at the two lines that name the old symbol. Before this change the same upgrade needed one hand edit, because `pll migrate` correctly refuses to rename into a module that already binds `hasPreviewIntent` — as that project's own wrapper did — and TypeScript's suggestion for the missing name was `PreviewRequestLike`.

  `payload-live-preview/package.json` is exported now. `require('payload-live-preview/package.json')` is how tooling reads the installed version, and it answered `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- 084217a: The Vite range is recorded and checked instead of assumed.

  `quality/compat-matrix.json` now carries the Vite each supported framework major installs — Astro 4 through 7 pull Vite 5 through 8, SvelteKit 2 accepts 5 through 8, Nuxt 3 pulls 7 — with the date it was measured. The compatibility section of the README states the resulting span from that record rather than from prose beside it.

  `npm run compat:check` stays offline and now fails three further ways: when the devDependency sits behind the newest major the record names, when a framework major the matrix tests falls outside its declared optional peer range, and when a fixture lockfile installs a Vite outside the recorded span. `npm run compat:refresh` re-reads the record from the registry the way `api:update` re-reads the API reports — with the network, for a maintainer to review as a diff.

  This started as an observation: the devDependency stood at Vite 7 while every fixture lockfile installed 8.2.2, and nothing anywhere compared the two. It is now the first thing that gate checks. Renovate also gives a devDependency major its own pull request rather than leaving it in the grouped non-major one, so the proposal arrives before the gate does.

- 422a71b: A wire corpus: messages captured verbatim from real Payload admins (3.85.0
  and 3.88.0) are replayed through the runtime in tests and checked by the
  weekly protocol watch against the official client. The README compatibility
  table carries one row per capture. The bug report template asks for the
  update strategy, the authorization mode and the `__livePreview.inspect()`
  output.

## 2.0.0-rc.1

### Major Changes

- 14e967d: Correctness and hardening pass over the whole package for 2.0.

  **Fixes you can observe**

  - Rich text: Payload 3.x link nodes carry their target in `fields`, which the
    renderer did not read — every link rendered as plain text. Inline blocks and
    tables render as well.
  - The keyed morph could consume live elements when the rendered markup began
    with a comment or indentation the live tree lacked, losing focus and form
    state in exactly the case the morph exists to protect. An attribute with an
    empty value (a boolean marker such as `data-payload-island`) is not a key,
    so sibling markers stop sharing one key, and the morph no longer strips key
    attributes off the page to disambiguate duplicates.
  - Focus and selection are restored after a keyed move, which is a remove and
    re-insert however the node is retained.
  - Strategies were planned against the whole document on every keystroke
    instead of the fields that changed, so a page using fragments re-rendered
    every boundary server-side per keystroke. `dependencies` were silently
    dropped on the route path.
  - With `skipUnchanged`, a route refresh reverted every unsaved field except
    the one being typed in.
  - `revealEditedField` follows nested bindings (`hero.title`, fields inside
    blocks and arrays), reveals after the write lands, and never lets a value too
    large or cyclic to compare claim the reveal from a field that changed. On a
    page previewing several documents it reveals the edited document's binding
    rather than the first element that happens to share the field name, and a
    field the server re-renders behind a `data-payload-fragment` boundary is
    revealed once that boundary has landed — previously it was never revealed at
    all, because only patched bindings were considered.
  - `destroy()` after `suspend()` was a no-op: the screen-reader live region
    leaked and no `destroy` event was emitted.
  - The scheduler could postpone a flush indefinitely under key repeat; it
    flushes within a bounded window.
  - `pll-codegen` could not follow an imported binding to the module that
    declares it, so a config split across files produced no types at all. It
    also refuses to overwrite an existing types file when the schema comes out
    empty.
  - `pll migrate` rewrites only identifiers bound by an import from this
    package, and reports the sites it cannot rewrite instead of leaving a
    dangling call. `pll doctor` no longer evaluates page-supplied JavaScript,
    follows redirects, or hangs on an origin that never answers.
  - Adapters mark every response they change `Cache-Control: private, no-store`
    with `Vary: Cookie`, refuse to rewrite a null-body status, drop
    `content-encoding` and `etag` when they rewrite a body, and keep the CSP
    nonce out of a response header. The SvelteKit handle no longer returns an
    empty page for a chunk without a `<head>`.
  - `mergeCspHeader` merges into every policy of a comma-joined header instead
    of widening the last one, and Nuxt no longer replaces an array-valued CSP
    header.
  - `definePreview` reads drafts with `cache: 'no-store'` and can express
    Payload's `or`/`and` queries.
  - The fragment and route clients no longer reject when a body read is aborted
    by a newer revision, and the fragment endpoint must be genuinely
    same-origin.
  - A binding that renders a sibling field through `data-payload-href`,
    `data-payload-src` or `data-payload-alt` is re-applied when that sibling
    changes. Under `skipUnchanged` only its own value counted, so editing just
    the URL left the link pointing at the old target while its text updated.
  - The Nuxt plugin detects preview intent when Nitro reports a relative
    `event.url`, and sets response headers on the response object rather than
    through a detached function, which threw on a real Node server.

  **Breaking**

  - The sanitizer's default policy is `strict` everywhere, not only inside the
    browser runtime. Server-rendered rich text can no longer introduce `id`,
    `name` or `data-payload-*` attributes. Item templates keep the attributes
    they need through `SanitizeOptions.templateMode`.
  - Lexical output uses classes instead of data attributes, which the strict
    policy strips: `lp-block--<slug>`, `lp-inline-block--<slug>`,
    `lp-relation--<slug>`, `lp-block-<kind>` for the built-in blocks (callout,
    image, video, code, cta), and `lp-align-*` / `lp-indent-*` in place of an
    inline `style`. Block fields are no longer serialized into attributes.
  - `email` is its own renderer and writes a `mailto:` URL; in 1.x it was an
    alias of `url`, which turned an address into a relative link.
  - One value contract for every renderer: an empty value or an unsafe URL
    clears the binding and counts as a write, rather than leaving the previous
    link or image in place. `<img>` writes rebuild or remove `srcset`/`sizes`.
  - Date bindings write local time into `date` and `datetime-local` inputs.
  - `generateInlineScript({ serverURL })` requires an explicit `mergeDepth`, as
    the client and the adapters do. The `nonce` option is gone; pass the nonce to
    `wrapWithScriptTag()`.
  - Removed: the `NextMiddleware` type and the `checkFetchDest` option.
  - `payload-live-preview/migrate`: `Codemod` describes a codemod (id, summary,
    ledger entry) without its `apply`, so importing this entry's types does not
    require `ts-morph` — an optional peer needed only to _run_ `pll migrate` and
    `pll-codegen`. `CodemodEdit` reports line-level edits instead of whole file
    contents, and `pll migrate` exits `3` when a file needs a human.
  - Added: `PreviewAdapterOptions` on every adapter entry; a configuration error
    thrown by `authorizePreview` propagates instead of being swallowed as an
    outage; the authorization outcome on framework locals
    (`LivePreviewLocals`); `defineLivePreviewServerHandler` for Nuxt, which
    decides early enough for pages to read the outcome; and
    `SanitizeOptions.templateMode`.

### Minor Changes

- 084217a: Add `pll-codegen annotate`: put `data-payload-field` where a template already
  prints a field, and report every place it will not guess at.

  ```bash
  npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts
  npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts --write
  ```

  Annotating a template by hand is the work this package asks for, and on an
  existing site it is the reason to keep using a hook instead. The codemod does the
  part that is unambiguous: an element whose entire content is one field access
  whose path the schema has — the shape that means the same thing in Astro, JSX and
  Svelte.

  ```astro
  <h1>{page.title}</h1>  →  <h1 data-payload-field="title">{page.title}</h1>
  ```

  Everything else is listed with a reason and left untouched: a value printed
  beside a label (a binding replaces the whole text), a call or an operator (no
  single field to name), a path the schema does not have, an array item inside a
  loop (nothing connects the loop variable to the field), a component's props, and
  anything already annotated. A missing binding costs an editor one invisible edit;
  a wrong one writes a value into the wrong element on every keystroke, and nobody
  looks for that in a diff a codemod produced.

  Nothing is written without `--write`. A dry run that found work exits 3, so a
  pre-commit hook can tell it apart from "nothing to do".

- 084217a: `delivery: 'asset'`: the runtime as a cached file instead of part of the page.

  A preview page carries about 30 KB gzip of runtime today. With `delivery: 'asset'` it carries a bootstrap instead — 679 bytes, measured on the Next.js example — which checks for a preview context and only then fetches the runtime from a route you mount:

  ```ts
  // app/payload-live-preview/[file]/route.ts
  import { createRuntimeAssetRoute } from 'payload-live-preview/nextjs';

  export const { GET } = createRuntimeAssetRoute(livePreviewOptions);
  ```

  The file is named after the hash of its contents, so the response says `Cache-Control: public, max-age=31536000, immutable` and means it, and the bootstrap loads it with `integrity` and `crossorigin="anonymous"`. The route answers that one name and 404s every other, rather than returning current bytes under an old name.

  `createRuntimeAssetRoute()` exists in all three route-serving adapters, each in the shape its framework wants: `export const { GET } = …` for a Next.js route file and a SvelteKit `+server.ts`, and a `Request` → `Response` function for a Nitro handler. What they answer is the same, because delivery is decided once, where the script body is built. Astro already had this as `mode: 'loader'` and keeps it — it emits and serves the file from its own build — but now reads the same asset descriptor rather than a second copy of it, and honours `runtime: LEAN_RUNTIME` there too.

  `RuntimeArtifact` gained `contentHash` and `integrity`, because an artifact that can be served has to be able to name and verify itself.

- 11dacbf: `autoBind: 'unique'` lets the runtime find bindings by value on the
  connection's first message, for a page that carries no `data-payload-field` at
  all. A scalar field whose value is the whole content of exactly one element in
  the body — its only text node, an attribute the writer may set, an `<img src>`
  for an upload — is bound to that element as if the attribute had been written
  there. Found nowhere, more than once, partially or split across nodes: nothing
  is bound, and the field stays as unbound as it was.

  Every guess is stamped onto its element as the attributes a template would have
  carried plus `data-payload-guessed` with the value it matched, is listed in
  `inspect().bindings.guessed`, and appears under its own heading in the
  unbound-fields overlay with the attribute to paste. A declared
  `data-payload-field` always wins; `data-payload-no-bind` keeps a subtree out.
  The option is off by default and is accepted by the client, the inline script
  and every adapter (ADR 0014).

  A route refresh keeps the guesses. The refresh morphs the page toward the
  server's markup, which carries no stamp, so the runtime looks for the guesses
  it already made on the fresh markup — by the value each was found by and by the
  field's current value — and for nothing else; a field the first message did not
  bind is not bound by a refresh either.

- 084217a: `livePreviewAnnotate()`: bindings written at build time, bound to the request's authorization.

  ```js
  // astro.config.mjs
  import { livePreviewAnnotate } from 'payload-live-preview/annotate';

  export default defineConfig({
    vite: { plugins: [livePreviewAnnotate({ inventory })] },
  });
  ```

  A template keeps the markup its author wrote — `<h1>{page.title}</h1>` — and the build rewrites it to `<h1 {...__lpPreview.bind('title')}>`, one helper per file, built from `Astro.locals`. The binding therefore exists for a preview the adapter authorized and does not exist for anyone else: the fixture's public response carries no `data-payload-*` at all, while the tokened one carries exactly the fields the template prints.

  What may be annotated is decided by the same scanner as `pll-codegen annotate` and nowhere else, so the two annotate the same places and refuse the same ones. A statically built page has no request to authorize and emits nothing; `allowPublicBindings: true` writes the plain attribute there instead, which is the same disclosure the codemod makes, said out loud.

  Astro only, and for a reason rather than a lack of time: the rewrite needs a template whose own scope can reach the request context. Frontmatter and `Astro.locals` give that; a Svelte or Vue component does not, since the verdict would have to travel through `load` or a serialized payload, where a function cannot go.

  It hooks `load`, not `transform`. Astro compiles `.astro` in a `transform` of its own registered ahead of anything a config contributes, so by the time a user transform runs the markup is already compiled away — measured with a probe plugin, not assumed. `name`, `enforce` and `load` are the whole surface used, all stable since Vite 5, and the majors it is exercised against are read from `quality/compat-matrix.json` rather than typed here.

  New: `payload-live-preview/annotate`, separate from `./codegen` so a build plugin never drags `ts-morph` into a project, and `previewBindingsFromLocals()` on `payload-live-preview/server` — the one-line helper the generated call uses, and useful by hand. `vite` is now an optional peer (`>=5.4.0 <9.0.0`), never a dependency.

- 11dacbf: When the runtime knows a patch cannot reach what the server would have drawn, it
  now asks a server to draw the region instead of leaving the degraded patch on the
  page. Three findings reach that decision:

  - a renderer that refused the value it was handed — an element with structured
    children (LP0402), an upload or image whose value carries no usable URL, an
    array renderer given something that is not one — or a field type with no
    renderer at all;
  - a Lexical block with no registered renderer whose server markup the write had
    to drop because the live and rendered trees do not line up (the case LP0410
    documents as the one it cannot keep);
  - a revision that changes a field with no binding anywhere, which is also how a
    section the template renders only under a condition looks from the page's side.

  Each escalates to the fragment strategy when a boundary covers the binding and
  to the route otherwise, once per element — a page with neither `fragments` nor
  `routeStrategy` has nothing to escalate to and keeps the patch, exactly as
  before.

  **`onUnboundChange` is renamed to `onUnfaithfulPatch`, and its default changes.**
  The new option takes `'ignore' | 'warn' | 'escalate'` and defaults to
  `'escalate'`; `'warn'` reports the new **LP0411** and keeps the patch; `'ignore'`
  keeps it silently, which is what 2.0 did. `onUnboundChange` still works and still
  decides when it is given — `'route'` means `'escalate'`, `'ignore'` means
  `'ignore'` — and is removed in 3.0.

  A page that configured no strategy sees no change. A page that did, and had left
  `onUnboundChange` at its default, will now refresh its route for a change nothing
  binds; `onUnfaithfulPatch: 'ignore'` restores the old behaviour.

- 11dacbf: On a Nuxt page the runtime's first write no longer lands before Vue has
  hydrated. Measured on the example: the runtime wrote the admin's document at
  25 ms, Vue hydrated at 94 ms and repaired every written value back to the
  server's — quietly, with only a development `console.error` — and what put
  them right again was the mock admin answering the runtime's second `ready`;
  Payload's admin answers `ready` once, so on a real page the first document was
  gone until the editor typed.

  Every script the Nuxt adapter emits now declares `hydration: 'vue'` (the
  second value of the inline option ADR 0015 added), and under it the runtime
  does not start until Vue has mounted the app around the bindings — observed
  through the `__vue_app__` property Vue puts on its container as `mount()`
  returns, with no polling and no armed bootstrap — and, on Nuxt, until a
  Suspense still hydrating at the mount has resolved. The cap, `LP0607` (which
  now names the mount it waited for) and `inspect().hydration` (`mode: 'vue'`)
  are the ones React's case has. The addendum to ADR 0015 records the
  measurement, the signals that were not usable and why, and the failure modes.

- 11dacbf: On a Next.js page the runtime's first write no longer lands before React has
  hydrated. Measured on the example: the runtime started on `DOMContentLoaded`,
  the admin answered `ready` at once, and the document was written 81 ms before
  React walked the server markup — React threw `Hydration failed because the
server rendered text didn't match the client`, regenerated the tree on the
  client and dropped the write, once per page load.

  Every script the Next.js adapter emits now declares `hydration: 'react'` — a
  new inline option, wire slot 23, unset everywhere else — and under it the
  runtime does not start (no `ready`, no listener) until React has committed the
  tree that holds the bindings, observed through React's instrumentation hook
  (`__REACT_DEVTOOLS_GLOBAL_HOOK__`, wrapped when a DevTools extension already
  owns it). A page whose React never commits starts after five seconds and
  reports `LP0607`; `inspect().hydration` reads `waiting`, `committed` or
  `timed-out`. Under asset delivery the bootstrap is a build that arms the
  observation before it fetches the runtime, which may otherwise arrive too late
  to be injected into. ADR 0015 records the decision and its failure modes.

- 4893767: `LP0501` is said out loud when a message is refused for coming from the wrong window.

  `eventSourcePolicy` is `'parent-or-opener'` by default since 2.0, where 1.x accepted any window on a trusted origin. An arrangement whose admin posts from somewhere else — a custom integration, a sibling frame, a harness — therefore stops updating on upgrade, and the refusal only ever reached the debug log, which is off in production and in most development. From the outside that looks like "live preview is broken", with nothing to go on.

  It is now reported once per page, naming the option, its 2.0 default and the 1.x behaviour, the same way `LP0503` reports protocol drift. No new code and no behaviour change: the message stays refused, and `eventSourcePolicy: 'any'` restores the old policy.

  This is the second of the three defaults 2.0 flipped in silence; `LP0409` covers the sanitizer. The third, `skipUnchanged`, deliberately gets no report — it skips writes whose value did not change, which is a cost decision rather than a visible one, and `inspect().revisions.skippedUnchanged` counts them.

- 11dacbf: A keystroke now reaches the preview in one animation frame instead of after the
  whole `debounceMs` window.

  The debounce exists to coalesce a burst of messages into one write, and the
  first message of a quiet phase is not a burst: it was waiting for a window with
  nothing in it to coalesce. The scheduler now applies that first write on the
  next frame and opens the window from there, so everything the burst brings after
  it is still batched exactly as before. Measured in jsdom against the runtime's
  own interaction gate, one isolated keystroke: **66.6 ms p95 → 16.6 ms p95**, and
  the same on a rich-text and a relationship field.

  This is only worth having because `dataMerge` no longer asks Payload on every
  message: a leading write that had to wait for a REST round trip would be a frame
  plus the network. For the common edit — typing into a text field — there is now
  no request and no window between the keypress and the page.

  Nothing to configure. `debounceMs` keeps its meaning for the burst, and
  `debounceMs: 0` behaves as it always did. A field that only the server can
  resolve still shows what the message carried until the shared answer lands, and
  is replaced when it does.

- 084217a: Add `payload-live-preview/lean`: a smaller runtime artifact for pages that need
  less.

  ```ts
  import { LEAN_RUNTIME } from 'payload-live-preview/lean';

  livePreview({ runtime: LEAN_RUNTIME, allowedOrigins: [ADMIN] });
  ```

  24 763 bytes gzip against the full runtime's 30 253. It leaves out the fragment
  and route strategies, the keyed morph, the structural arrays, the item templates
  and the screen-reader announcer; everything else is the same runtime — the same
  message bus, origin rules, merge and renderers for text, numbers, dates, images,
  uploads, relationships and rich text.

  A page that needs one of the omitted features is told so once, with LP0104, and
  its markup is left exactly as the server rendered it. Never half-applied, never
  silent. The two strategies and the lean artifact exclude each other outright, and
  the generator refuses that combination rather than emitting a prelude with
  nothing to talk to.

  It is an imported value rather than a `profile: 'lean'` option because that is
  what keeps it free for everyone else: measured on this package, a string option
  put the second artifact into every adapter entry and grew each by 24 KB gzip.
  This way the bytes follow the import.

- 11dacbf: `dataMerge` now asks Payload only when the answer can change what the page
  shows. Until now every accepted message cost one authenticated POST to the REST
  API: eighteen keystrokes, eighteen requests, and nineteen of them on a page with
  no binding at all.

  Three decisions, in this order (`src/core/merge-need.ts`):

  - **Nothing reads a populated value → no request.** A page with no binding, no
    island, no `data-payload-fragment` boundary and no `beforeUpdate`/`afterUpdate`
    listener has nobody to hand the answer to; so does a page whose every binding
    is a plain scalar renderer on a top-level field. A route refresh is not a
    reason to ask: it re-renders the page from the server and never reads these
    values.
  - **Nothing populated moved → no request.** The fields the editor changed are
    taken from the message and everything else is carried over from what the last
    merge resolved. Typing into a text field costs nothing.
  - **Otherwise one request opens the burst and one closes it.** The rest share
    the request that follows the window, which is the scheduler's `debounceMs`;
    `debounceMs: 0` turns the window off and keeps the two skips. The page never
    waits for a shared request — it renders what it already has, and the answer
    refines it when it lands.

  A field that names a document is never rendered from the bare id the panel posts
  for it: the value the last merge resolved stays on the page until the new one
  arrives.

  What changes for a page that reads no populated value at all: it no longer sees
  values a collection's `afterRead` hooks would have changed on the way back. Bind
  one field through a relationship path (`data-payload-field="venue.title"`) and
  the page merges as before.

- 084217a: Add the fragment endpoint to the Next.js adapter, and let every adapter point at
  one.

  Server-rendered boundaries existed only for Astro. That was never a limit of the
  endpoint — its authorization, protocol, limits and registry lookup never touched
  a component system — but the only export lived in `payload-live-preview/astro`,
  so a Next.js project had to import the Astro entry and pass its own `render` to
  get a boundary rendered. The endpoint now lives in
  `@adapters/shared/fragment-endpoint`, and each adapter binds a renderer to it in
  a few dozen lines.

  ```ts
  // app/payload/fragment/route.ts
  import { createFragmentEndpoint, defineFragment } from 'payload-live-preview/nextjs';
  import { Hero } from '@/components/Hero';

  export const POST = createFragmentEndpoint({
    authorizePreview,
    registry: {
      hero: defineFragment(Hero, ({ fields }) => ({ title: String(fields.title ?? '') })),
    },
  });
  ```

  `defineFragment()` pairs a component with the props it takes, so a renamed prop
  is a type error in the registry instead of an empty boundary in the preview.
  React renders through `renderToString()`; `react` and `react-dom` are optional
  peers imported at the first render, so a project that registers no fragment
  never loads them — as `astro` already was for the Astro binding.

  The `fragments: { endpoint }` option moves from the Astro adapter's options to
  the shared ones, so the Next.js, SvelteKit and Nuxt adapters accept it too. It
  only names a same-origin path the runtime posts to; which framework serves that
  path is the endpoint's business.

  A render that throws now also logs the boundary's id and the message once per
  process, outside production. The response stays a generic `500 {"error":"render"}`
  — from the browser a component that throws on every request was indistinguishable
  from a network fault, and nothing said which boundary it was.

- 11dacbf: New: **`<LivePreviewScript />`** from `payload-live-preview/nextjs` — a Next.js
  delivery that charges a public visitor nothing.

  Until now a Next.js project put the script in its root layout by spreading
  `livePreviewScriptProps()`. That helper is synchronous, so it cannot wait for an
  authorization verdict and does not try: it builds the script for whoever is
  asking, and a root layout renders for everyone. Measured on a real site, a
  request with no cookie and no preview intent came back with 195 342 of 254 707
  bytes of preview runtime — 77 % of the page. Next renders a layout's `<head>`
  twice, once into the HTML and once more into the RSC flight payload underneath
  it, so the runtime shipped twice as well.

  `<LivePreviewScript />` is an async server component. It runs the same policy
  the middleware runs — preview intent, then `authorizePreview` — and renders
  nothing at all for a request that is not an authorized preview. Not a bootstrap:
  nothing, the same as the Astro middleware, the SvelteKit `handle` and the Nuxt
  Nitro plugin already deliver.

  ```tsx
  // app/layout.tsx
  import { headers } from 'next/headers';
  import { LivePreviewScript } from 'payload-live-preview/nextjs';
  import { authorizePreviewRequest } from 'payload-live-preview/server';

  export default async function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <head>
          <LivePreviewScript
            request={new Request(process.env.SITE_ORIGIN!, { headers: await headers() })}
            inject="always"
            allowedOrigins={[process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!]}
            authorizePreview={(request) =>
              authorizePreviewRequest(request, {
                type: 'payload-session',
                serverURL: process.env.PAYLOAD_URL!,
              })
            }
          />
        </head>
        <body>{children}</body>
      </html>
    );
  }
  ```

  It takes the request as a prop rather than importing `next/headers` itself, the
  same reason `<LivePreviewRouteRefresh />` takes the router's refresh as one:
  `next` is not a dependency of this package. A `Request` is what
  `authorizePreview` and `shouldInject` already receive from the middleware, so one
  options object serves both.

  Next hands a server component the request headers and cookies but not its URL, so
  a layout cannot see `?preview=true` and the default `previewSignals: ['query']`
  cannot fire there. `inject: 'always'` makes the authorization hook the only gate,
  which is the stricter reading anyway; a **page** gets `searchParams` and can pass
  the real URL, which the `signed-token` strategy needs because it binds a token to
  a path. Both recipes are in `docs/nextjs.md`.

  `livePreviewScriptProps()` and `renderLivePreviewScript()` are unchanged and stay:
  the first for a layout that is not gated, the second for HTML a server assembles
  as a string. `delivery: 'asset'` remains the answer for a script built once at
  module scope — a 696-byte bootstrap instead of the runtime. What each choice costs
  a visitor, measured: `docs/deployment.md`.

- 084217a: Add `livePreviewScriptProps()` to the Next.js adapter.

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

- 084217a: Add `onUnboundChange`, so an edit to a field the page does not bind is no longer
  invisible.

  Patching reaches what the markup annotates. Until now a revision that changed a
  field with no `data-payload-field` anywhere did nothing at all: the preview kept
  showing the old value with no sign that anything had happened. A framework hook
  that re-renders the whole component tree has no such failure mode, and that was
  the one thing the official React and Vue packages did better.

  `onUnboundChange: 'route'` refreshes the route for such a revision instead.
  Where a binding exists the page is still patched in place, focus and scroll
  intact; only the change nothing covers costs a refresh. The default stays
  `'ignore'`, so nothing changes for an existing setup.

  A binding on the field, on its locale-suffixed name, or on a path inside it
  (`hero.eyebrow` covers the field `hero`) all count as covered. The fields Payload
  sends with every document are never counted, and the connection's first message
  is skipped — there every field looks changed and the page has just been rendered
  from them. The refresh reports `LP0807`.

- 084217a: Make protocol drift visible: LP0503 in the browser, and an issue from the weekly
  watch.

  This package mirrors Payload's postMessage protocol by hand and has no `payload`
  dependency, which is what lets it run on Astro, static pages and plain HTML. The
  price is that a newer admin can send something this runtime does not recognise —
  and until now such a message was dropped in silence, which from the outside looks
  exactly like "live preview stopped working".

  Now a message from an origin the page already trusts that misses the expected
  shape, or carries a type this version has no meaning for, prints LP0503 once with
  the origin and which of the two it was. Once per page: a drifting sender repeats
  the same shape on every keystroke, and thirty identical lines would hide the rest
  of the console. An untrusted origin still says nothing — that is a refusal, not
  drift.

  The weekly protocol watch, which executes the published Payload client and
  asserts the behaviours this package relies on, now files what it found as a
  GitHub issue instead of only turning a scheduled run red. It updates the open
  issue rather than opening a second one, and only for the `latest` matrix entry:
  `canary` churns before it stabilises, and an issue per pre-release would train
  everyone to ignore the label.

- 084217a: Add `payload-live-preview/react`: `useLivePreviewDocument()`, the merged document
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

- 4893767: The replay store for `signed-token` is one atomic `consume(id, expiresAt)`.

  The 1.x store was two calls, `isUsed` and then `markUsed`, and a review of
  1.8.1 named the consequence: two requests carrying the same token that arrive
  together both pass `isUsed` before either reaches `markUsed`, so the optional
  replay protection did not protect against the one case it exists for. The
  package cannot make two calls one step, so the contract is now one call: the
  store checks and records at once (Redis `SET NX PX`, a unique insert) and
  answers `true` when this use was the first. Any other answer refuses the token
  as `replayed`, a throw as `unavailable`.

  The `isUsed`/`markUsed` shape is still accepted as `PreviewTokenReplayChecks`,
  deprecated with the race stated in its notice, and removed in 3.0. A unit test
  pins both halves: the atomic shape admits exactly one of two simultaneous
  requests, the deprecated one admits both.

- 1d5b302: Reveal the edited section in the preview. With `revealEditedField: true`, when
  a field's value changes the preview scrolls that field's bound element into
  view, so the section under the editor's cursor is visible without manual
  scrolling — the route strategy brings up the right page; this brings up the
  right section. It is conservative by design: it scrolls only when the target
  is off-screen and only when the edited field changes, honors
  `prefers-reduced-motion`, and never fights a deliberate manual scroll. Off by
  default.

  Opt-in admin side: `createPreviewFocusReporter` / `reportPreviewFocus` let a
  Payload field component report the focused field (a
  `payload-live-preview-focus` message), so the preview reveals a field the
  cursor moves into even without typing. docs/reveal.md covers both halves.

- 11dacbf: A route refresh the minimum interval holds back is now run once when the
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

- 084217a: Add `routeStrategy`, so a page can refresh its route without configuring a
  fragment endpoint.

  The route strategy used to arrive only inside the fragment prelude, and the
  generator emitted that prelude only for a page with a `fragmentEndpoint`. A
  binding marked `data-payload-strategy="route"`, or one in `<head>`, therefore
  did nothing outside Astro — the one framework with a `createFragmentEndpoint()`
  helper.

  `generateInlineScript({ routeStrategy: true })` and the same option on every
  adapter now emit a second, smaller prelude carrying the route strategy alone:
  2 068 bytes gzip against the fragment prelude's 3 791. Setting both is not a
  double cost — `fragmentEndpoint` wins, because its prelude already contains the
  route strategy.

  A page that sets neither is unchanged apart from 36 bytes gzip: the runtime now
  looks for the second prelude as well.

- 084217a: `LP0409`: the strict sanitizer now says what it removed.

  `sanitizerPolicy` defaults to `'strict'` since 2.0; the 1.x default was `'compat'`, which let `id`, `name` and every `data-*` through. The difference only appears when a binding _writes_ markup, so an upgraded project loses its own hooks at the moment an editor types — in the preview, silently, with nothing in any log. Found by upgrading a real 1.8.1 site: a `data-*` attribute driving a CSS selector disappeared on the first write.

  The removal stays — it is a security decision, and the migration guide has always documented it. What is new is that it is said, once per attribute name, with the reason that applies to that name: `id` and `name` because content that can name an element can shadow a global of that name; `data-payload-*` because a binding inside CMS content would let an editor aim a write at any element on the page; every other `data-*` with the two ways to keep it — `allowedDataAttributes`, or `sanitizerPolicy: 'compat'` for the 1.x behaviour.

  Costs ~130 B gzip in every bundle that carries the runtime, the lean profile included. It buys the one 2.0 change an upgrading project could otherwise only discover by looking at the page.

- 11dacbf: The runtime says so when it writes a different reading of a date, a number or
  a checkbox than the template printed. On the first write to such a binding —
  and only when it carries no `data-payload-format` — the preview holds what the
  element showed against what it is about to show, and reports `LP0412` once if
  they differ, naming both readings.

  It is a diagnostic and nothing else: the value is still written, no strategy is
  asked for a re-render, and a page under `onUnfaithfulPatch: 'ignore'` hears
  nothing. There is no way for the runtime to tell "the template formatted this
  differently" from "the field was edited before the preview connected", so the
  message names both and points at the one attribute that settles either.

- 084217a: Add the fragment endpoint to the SvelteKit and Nuxt adapters, and a gated
  `boundary()` helper for the markup that marks one.

  Server-rendered boundaries now exist for every framework this package adapts.
  The endpoint itself is the same code as before — authorization, protocol,
  limits, registry — and each adapter binds one renderer to it:

  | Framework | Import                           | Renders with          |
  | --------- | -------------------------------- | --------------------- |
  | Astro     | `payload-live-preview/astro`     | `astro/container`     |
  | Next.js   | `payload-live-preview/nextjs`    | `react-dom/server`    |
  | SvelteKit | `payload-live-preview/sveltekit` | `svelte/server`       |
  | Nuxt      | `payload-live-preview/nuxt`      | `vue/server-renderer` |

  ```ts
  // src/routes/payload/fragment/+server.ts
  export const POST = createFragmentEndpoint({
    authorizePreview,
    registry: { hero: { component: Hero, props: ({ fields }) => heroProps(fields) } },
  });
  ```

  `svelte` and `vue` join `astro`, `react` and `react-dom` as optional peers,
  imported at the first render. Nuxt's binding takes a `Request` — what
  `toWebRequest(event)` makes of an H3 event — so this package needs no `h3`
  dependency to describe its own signature. Svelte's binding delivers `render()`'s
  `body` only: `<svelte:head>` output belongs to the document head, which the route
  strategy owns.

  `createPreviewBindings().boundary('hero', { dependsOn: ['title'] })` writes the
  boundary attributes under the same authorization gate as `bind()` — a registry id
  and the fields it depends on describe the content model as much as a field name
  does — and refuses an id the endpoint would refuse, instead of leaving a boundary
  that silently never renders.

  Two notes the guides now carry, both learned from the fixtures: Svelte's server
  renderer keeps its component context in a module variable, so the binding imports
  `svelte/server` by name and the consumer's bundler resolves it in the same graph
  as the components; and Nitro's rollup needs `@vitejs/plugin-vue` to read a
  single-file component inside the server bundle.

- 084217a: Add `createUnboundFieldsOverlayPlugin()`: a development overlay that lists the
  fields an update carried and the page has nowhere to put.

  ```ts
  import { createUnboundFieldsOverlayPlugin } from 'payload-live-preview/plugins';

  void client.use(createUnboundFieldsOverlayPlugin());
  ```

  Annotating a template is the work this package asks for, and the hard part is
  knowing what is still missing. `inspect().bindings.orphanFields` answers that in
  the console — the wrong place while you are editing markup. The overlay puts the
  same answer in the preview, and a click copies `data-payload-field="…"` for the
  field you picked.

  It recomputes on every update from the message's own fields and the bindings
  currently in the DOM, so entries disappear as you save the file that binds them.
  The rule for "covered" is the runtime's own: the fields Payload sends with every
  document never appear, a locale-suffixed name counts, and a binding on a path
  inside a field — `hero.eyebrow` for `hero` — covers it.

  It mounts only when the client runs with `debug: true`, and it is a plugin rather
  than part of the runtime so that no page carries a development tool it did not
  ask for: the inline script's byte budget is unchanged by it.

- 11dacbf: The line about a Lexical block with no renderer now says what happened to it,
  not what was meant to happen. `LP0410` used to be reported while the block was
  being rendered — before the write knew whether the server's markup for it could
  be kept — so on a page where the pairing failed the console said "keeping what
  the server rendered" while the image was being deleted. The write speaks now,
  after the fact, in two texts: `LP0410` when the server's markup stands, and the
  new `LP0413` when it is gone. The second is also the finding `onUnfaithfulPatch`
  acts on, so a fragment or route strategy redraws the region where the page has
  one.

  `inspect()` gains a `fidelity` section: `{ mode, unfaithful, escalated, fields }`.
  `unfaithful` counts every binding the runtime knew it could not patch faithfully
  (once per element, under every mode, `'ignore'` included), `escalated` how many
  of those a strategy was handed. A positive `unfaithful` beside `escalated: 0`
  and `route.handler: false` is the reading a page with a degraded preview and no
  strategy shows — three facts that were not visible from the outside before.

  `lexicalToHtml()` no longer writes to the console for such a block. Its options
  take an `onUnrenderedBlock(blockType, placeholderClass)` listener instead, and
  `RenderNodeContext` carries it to the node renderers; a custom node renderer
  that wraps blocks passes it on by rendering through `ctx.renderChildren`, as
  before.

- 084217a: Add `data-payload-format`, so a bound date or number can be written the way the
  page writes it.

  Until now a bound date was always a localised date and time, and a bound number
  always the locale's plain grouping. A template that shows `17 October 2026` or
  `€12.00` therefore had to leave those fields unbound — and an unbound field is
  one an editor changes without seeing anything happen.

  ```astro
  <time data-payload-field="startsAt" data-payload-format="date:long">17 October 2026</time>
  <span data-payload-field="price" data-payload-format="currency:EUR">€12.00</span>
  ```

  The vocabulary is closed — `date`, `date:short|medium|long|full`, `time`,
  `datetime`, `number`, `number:0-4`, `currency:XXX`, `percent` — because anything
  a page could pass beyond it would be code running inside the preview. An unknown
  value reports `LP0408` once for that element and writes the value unformatted.

  No relative form ("in 3 days"): choosing the unit and its rounding is policy
  rather than formatting.

- 084217a: Add `payload-live-preview/vue`: the same merged document as a composable.

  ```vue
  <script setup lang="ts">
  import { useLivePreviewDocument } from 'payload-live-preview/vue';

  const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
    serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
    allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_URL],
    initialData: props.page,
    depth: 1,
  });
  </script>
  ```

  It is the React hook's session with Vue's reactivity on top — the four returned
  values are refs — so the five differences from `@payloadcms/live-preview` hold
  here too: a trailing slash on `serverURL` still merges, a slow response never
  overwrites a newer one, a failed request keeps the last good document, an HTTP
  error body never becomes the document, and two composables on one page have two
  caches.

  Call it from `setup()` or inside an `effectScope()`. The subscription is released
  with that scope; a call without one throws instead of leaking a window listener
  and a request in flight for the life of the page.

  `vue` is an optional peer, imported by this entry alone. With the SvelteKit and
  Nuxt fragment endpoints and the React hook, the package now covers both official
  live-preview packages and every framework it adapts.

- 084217a: Setup in one line per framework.

  `payload-live-preview/nuxt-module` is a Nuxt module: add it to `modules` and write the options under `livePreview` in `nuxt.config.ts`. It generates the Nitro plugin you would otherwise have written into `.nuxt/` and registers it, so the generated file stays readable as the hand-written setup it replaces. Options are serialized into it, which is why `authorizePreview` and `shouldInject` are not part of the module's option type — a preview that needs either still registers `livePreviewNitroPlugin()` by hand.

  `withLivePreview(nextConfig, { allowedOrigins })` from `payload-live-preview/nextjs` writes the two headers a preview needs and only `next.config.ts` can give it: `frame-ancestors` and `private, no-store` on requests carrying preview intent, appended to an existing `headers()` rather than replacing it, plus the admin host in `allowedDevOrigins`. It is gated on intent alone, so a site with its own CSP or a stricter gate keeps using `createLivePreviewMiddleware`.

  SvelteKit needed nothing: `livePreviewHandle` is already a single export in `hooks.server.ts`.

### Patch Changes

- 084217a: Docs: one page that says what the package is, and a reason beside every option.

  `docs/architecture/overview.md` is the map the decision records never had: two screens and the one message that crosses between them, the five objects that answer the two hard questions — the decision, the authorization, the binding, the strategy, the runtime — the three strategies with when each is the right one, and one line of justification for every rule the records expand on, each linked to its record. `docs/options.md` gains the same treatment from the other side: the forty-five rows are grouped into the eight decisions they actually represent, so the table reads as eight questions rather than a list.

  Two types are gone, both concepts with no remaining reason: `PreviewBindingsCommonOptions`, a one-member base left behind when its sibling options type was removed in 2.0, and `AnnotatableEntry`, which had one member and one use. The public surface is five declarations smaller than before this pass.

- 084217a: Lead the documentation with the boundary, not the field binding.

  On a server-rendered page one attribute per component is enough: the region is
  rendered again from the unsaved form state, so conditional sections and derived
  values stay correct without naming a single field. The docs led with per-field
  annotation instead, which made the package look like more work than it is —
  three lines against twelve for the same component, and the twelve-line version
  still misses the section that only exists when a field is set.

  `bindings.md` now opens with the choice and what each option costs: a boundary
  needs a server at request time and the fragment endpoint; field bindings work on
  a static build and keep focus and the caret where a re-render would not — which
  is why both together, boundary for the component and bindings for the fields
  being edited, is the normal case rather than a compromise. `README.md`,
  `astro.md` and `hybrid.md` follow the same order.

  No behaviour changes; every attribute in the docs already existed.

- 1af4696: `pll doctor --v2` no longer reports four readiness gaps on every 2.0 page. It read an empty slot of the inline configuration as the 1.x value, while the 2.0 runtime runs the 2.0 one. The inline script now names the defaults it was generated against, and the doctor reads that instead of guessing; a script without it — from 1.x or `2.0.0-beta.0` — is still read as 1.x, and the report says so.

  `generateInlineScript({ defaults: 'v1' })` restores the 1.x runtime rows, as documented. It wrote the same configuration as the 2.0 default before, so a page built by hand ran the strict sanitizer, skipped unchanged bindings, accepted only its parent or opener and ignored the referrer, although it had asked for 1.x. The adapters resolved the profile themselves and were not affected.

- 084217a: Fix: a Nuxt production build rewrote the embedded runtime.

  Nitro's rollup replaces `typeof window` with `"undefined"` everywhere in a bundle — string literals included (`@rollup/plugin-replace` with no notion of code versus data). The runtime travels as exactly such a literal, so a `nuxt build` came out with all six occurrences rewritten: every `typeof window` guard in the runtime inverted, and bytes that no longer matched the integrity hash computed over them. `nuxt dev` externalizes the package, which is why the E2E suite never saw it; mounting the new asset route did, as a failing SRI check.

  The generated constants are now emitted as chunks split inside each such token and joined at load (`scripts/serialize-source.ts`). The value is identical and the cost is a few bytes; `.join('')` rather than `+` because esbuild and terser both fold `"a" + "b"` back into one literal and hand the token straight to the next bundler. `process.env`, `import.meta` and `globalThis.process` are treated the same way, and a test asserts no generated file carries one of them whole.

- df911f1: One name and one shape per option, across the adapters, the intent detector
  and the fragment endpoint:

  - `hasPreviewIntent()` takes `allowedOrigins`, the name the adapters, the
    client, the inline config and `pll doctor` use. `adminOrigins` is a
    deprecated alias, removed in 3.0; `allowedOrigins` wins when both are given.
  - `createFragmentEndpoint()` accepts `authorizePreview` — the page
    middleware's hook, with the same callback type and the same rules (a context
    from `authorizePreviewRequest()` authorizes, any other outcome refuses, a
    configuration error propagates) — called with the page request the fragment
    belongs to. `authorize` still takes a strategy; giving both throws at
    construction, naming both.
  - `LivePreviewLocals`, exported from `./astro`, `./sveltekit` and `./nuxt`,
    types what the adapters publish on `Astro.locals`, `event.locals` and
    `event.context` (`livePreviewNonce`, `livePreviewAuthorization`,
    `livePreviewAuthorizationOutcome`). The adapters write through it, so
    `interface Locals extends LivePreviewLocals {}` cannot drift from the code.

- 084217a: Docs: what a public visitor actually pays, per delivery, held by tests.

  `docs/deployment.md` gains a table with three outcomes rather than one claim: a setup that decides per request (SvelteKit handle, Nuxt Nitro plugin, Astro middleware) sends a visitor neither runtime nor bootstrap; a statically built Astro site in `mode: 'loader'` and a Next.js layout with `delivery: 'asset'` send the 679-byte bootstrap, which fetches nothing outside a preview; a Next.js layout with the inlined script and an Astro `mode: 'inline'` build send the whole runtime to everyone.

  Every row is pinned by a case in `tests/e2e/specs/public-response.spec.ts`, against the fixture it describes, so the table cannot drift from what the adapters do. Two further cases hold the claims underneath it: the gap between the same page inline and on asset delivery is the runtime, and a request that claims `?preview=true` without passing `authorizePreview` gets the public response byte for byte.

  No behaviour changed. The sentence "a visitor pays nothing" was true of some setups and not others, and now says which.

- 11dacbf: `externallyUpdatedRelationship` is read as an event, not as a flag. Payload's
  panel fills the field from `useDocumentEvents().mostRecentUpdate` — a state that
  every save of the previewed document raises and that nothing ever clears — so
  from the first save on, every message carried it. The runtime read each one as a
  fresh drawer edit: `skipUnchanged` was off for the rest of the session, every
  binding was rewritten on every keystroke, and `relationshipUpdate` fired once per
  keystroke with an event that named the previewed document itself.

  The update now re-renders, and the event now fires, only when the document event
  changed since the last message _and_ names a document other than the one on the
  page. A message that does not say which document it previews still takes the
  event at its word — once. Replaying the recorded Payload 3.88 session
  (`tests/fixtures/wire-corpus/payload-3.88.0.json`, which crosses a save): four
  `relationshipUpdate` events become none, and the writes after the save go from
  none skipped to thirteen.

- 11dacbf: A Lexical block with no registered renderer survives an edit on a page whose
  template wraps the rich text in a `<div class="prose">` — the usual Tailwind
  shape, and the shape the block-keeping write could not see. The write paired
  the bound element's children with the rendered document's positionally, and a
  wrapper is one child where the document has many, so the pairing stopped and
  the empty placeholder was written over the server's `<figure>` after all:
  measured on a Payload 3.88 post, one image and 1 272 characters before an edit
  to the _title_, none and 501 after.

  The write now pairs inside the wrapper and writes into it, so the wrapper — and
  the classes the typography hangs on — stays as well. A wrapper is the bound
  element's only child, a `div`, `section` or `article`, without a binding of its
  own, standing where the rendered document has several elements and unlike every
  one of them; a `<div>` a registered block renders is content, and a paragraph
  typed after it is written beside it, not into it.

- 084217a: Fix: on Vite 8, importing one helper from the root barrel shipped the whole package.

  Vite 8 bundles with Rolldown instead of Rollup. The runtime source is emitted as chunks joined at load, and Rolldown would not prove that call pure, so it kept the array and everything reachable from it: `import { escapeHtml } from 'payload-live-preview'` came out at 32 512 bytes gzip instead of 220. Rollup had dropped it either way, which is why the tree-shaking gate — pinned to Vite 7 — never saw it.

  The expression is annotated `/* @__PURE__ */` now, which both esbuild and terser preserve: the same import is 2 378 bytes gzip on Vite 8 and unchanged on Vite 7. The focused entries (`payload-live-preview/lexical`, `/structural`, `/core`, `/react`, `/vue`, `/plugins`, `/lean`) were never affected and stay within a few percent of their Rollup figures.

  The tree-shaking gate runs on Vite 8 from now on, because that is what Astro 7 and Nuxt install. Every budget in it was re-measured against Rolldown, which is less precise than Rollup at dropping unused declarations out of a bundled module — the numbers moved, the package did not.

- df911f1: The sanitizer policy is per client instance. `sanitizerPolicy` — from the
  client configuration or the inline script — travels with its runtime into
  every renderer's `RenderContext` (`context.sanitizerPolicy`), so two clients
  on one page each sanitize with their own policy, and constructing one no
  longer changes what the other renders. `setSanitizerPolicy()` remains the
  process-wide default for code that calls `sanitizeHtml()` directly, and the
  fallback for a render context without a policy.
- 4893767: The strict-mode refusals name the staged path.

  `strict` is the default since 2.0, and its three startup errors — a missing `authorizePreview`, an empty `allowedOrigins`, a non-https admin origin in production — stop a process that worked on 1.x. Each stated its rule and nothing else, which left an upgrader to discover on their own that a staged path exists.

  They now end with it: `defaults: 'v1'` keeps the 1.x table while you migrate, and `docs/migration.md` has the rest. The rules are unchanged; the way out is in the message that stops you rather than only in a guide you have not opened yet.

  Together with `LP0409` and `LP0501`, this closes the three shapes a 1.x project meets on upgrade: an option whose default flipped in silence, a message quietly refused, and a process that refuses to start.

- 084217a: `livePreviewHandle` composes with SvelteKit's own `Handle` type.

  The returned handle declared a fixed shim for the request event, which worked
  one way only: SvelteKit's real `RequestEvent` is assignable to the shim, but its
  `resolve` — which takes that real event — is not assignable to a resolve that
  takes the shim. Wrapping the handle in one of your own therefore failed to
  compile even though every value matched. It is generic in the event now, and the
  event passes through untouched.

  The adapters also declare what they write to a framework's request context
  (`LivePreviewLocalsSink`) instead of `Record<string, unknown>`: an `App.Locals`
  interface has no index signature, so it was not assignable to a record.

- df911f1: Polish from the 2.0 readiness pass.

  - `CachedElement.boundary` is renamed `hidesWhenEmpty`: the flag marks a
    `data-payload-boundary` empty-field anchor that hides itself while its field
    is empty, and the old name read like a fragment boundary. Only a custom
    renderer that inspected the flag is affected; TypeScript reports the old
    name.
  - Constructing a client without a document fails at once with a message that
    names the `root` option, instead of a `TypeError` on the first DOM read in
    `start()`.
  - A route refresh that outlives its timeout is logged as a timeout
    (`LP0801 route refresh timed out after N ms`), not as the browser's
    `AbortError` text.
  - The per-template sanitizer options cache is bounded (64 entries, least
    recently used evicted).
  - `defaults: 'v1'` on `LivePreviewClient` fills every 1.x row
    (`sanitizerPolicy: 'compat'`, `skipUnchanged: false`, referrer detection on,
    any event source). Before this fix the client left the config alone and fell
    through to the runtime's own fallbacks, which are the 2.0 values, so a v1
    client without explicit values sanitized strictly. The inline script was not
    affected: the adapters put the v1 rows on the wire.

- 11dacbf: A Lexical block with no registered renderer no longer deletes the markup the
  server rendered for it. `lexicalToHtml()` renders such a block as an empty
  `<div class="lp-block lp-block--<slug>">`, and until now the `richText` write
  put that empty element on the page over the `<figure><img></figure>` a project's
  own server had already produced for the same block — measured on a Payload 3.88
  post: 1 286 characters and one image before the patch, 501 and none after,
  triggered by an edit to the _title_.

  The write now pairs each placeholder with the element standing in its position
  in the live markup and leaves that element where it is, so the rest of the
  document is written and the block survives. Pairing is positional — the server
  writes no id to match on — and stops where the child counts disagree; then the
  placeholder is written after all, exactly as before.

  New diagnostic **LP0410**, once per block type: `no renderer for block "x";
keeping what the server rendered for it.` Register one with
  `registerBlockRenderer()` (or `registerDefaultBlocks()`) to render it in the
  browser too.

- 084217a: A 1.x project compiles against 2.0 without an edit.

  Measured against the published 1.8.1 declarations rather than assumed, and entry by entry rather than at the root alone: of the 114 names the root entry exported, eight are absent from 2.0, and `./astro` lost four of its own. Seven of those moved behind `definePreview()` or changed shape — `fetchPreviewDocument()`, `fetchPreviewGlobal()` and their option types, and `CAPABILITY_REQUIREMENTS`. One was a plain rename, and that one is back on **both** entries that exported it: `isPreviewRequest` is a deprecated alias of `hasPreviewIntent`, removed in 3.0, so the most common 1.x import keeps working and an editor names the successor at the call site. `./astro` also regained `PreviewSignal`, which 2.0 had stopped re-exporting although the type still exists.

  What is deliberately not aliased is everything whose _meaning_ changed rather than its name: the fetch helpers (`depth` was defaulted independently of the runtime's `mergeDepth`), `CAPABILITY_REQUIREMENTS` (a version map became a declaration table) and `NextMiddleware` (the middleware takes a response now). An alias there would type something the package no longer produces; TypeScript names each of them at the call site instead, and `docs/migration.md` says what to use. The fetch helpers deliberately have no alias: they defaulted `depth` to `1` independently of the runtime's `mergeDepth`, and a shim would restore the mismatch the move exists to remove.

  Verified on a real 1.8.1 consumer, upgraded untouched: 201 Astro files, **0 errors**, two deprecation hints pointing at the two lines that name the old symbol. Before this change the same upgrade needed one hand edit, because `pll migrate` correctly refuses to rename into a module that already binds `hasPreviewIntent` — as that project's own wrapper did — and TypeScript's suggestion for the missing name was `PreviewRequestLike`.

  `payload-live-preview/package.json` is exported now. `require('payload-live-preview/package.json')` is how tooling reads the installed version, and it answered `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- 084217a: The Vite range is recorded and checked instead of assumed.

  `quality/compat-matrix.json` now carries the Vite each supported framework major installs — Astro 4 through 7 pull Vite 5 through 8, SvelteKit 2 accepts 5 through 8, Nuxt 3 pulls 7 — with the date it was measured. The compatibility section of the README states the resulting span from that record rather than from prose beside it.

  `npm run compat:check` stays offline and now fails three further ways: when the devDependency sits behind the newest major the record names, when a framework major the matrix tests falls outside its declared optional peer range, and when a fixture lockfile installs a Vite outside the recorded span. `npm run compat:refresh` re-reads the record from the registry the way `api:update` re-reads the API reports — with the network, for a maintainer to review as a diff.

  This started as an observation: the devDependency stood at Vite 7 while every fixture lockfile installed 8.2.2, and nothing anywhere compared the two. It is now the first thing that gate checks. Renovate also gives a devDependency major its own pull request rather than leaving it in the grouped non-major one, so the proposal arrives before the gate does.

## 2.0.0-beta.0

Pre-release of 2.0.0. Its changes are listed under 2.0.0.

## 1.8.1

### Patch Changes

- bb05411: Fix: a multiline text field stopped updating after its first update.

  The text renderer writes a value containing newlines as `innerHTML` with `<br>`
  separators. That gives the element element-children, and the guard that
  protects consumer markup — "this element has structured children, refuse rather
  than destroy them" — then fired on the renderer's own output. Every later
  update to that binding was refused with LP0402, and the field stayed frozen for
  the rest of the session while its siblings kept updating.

  The guard now ignores `<br>` children specifically. Its purpose is unchanged:
  it preserves a styled wrapper around the value, and an element whose children
  are nothing but line breaks is not a wrapper — it is the value. A real wrapper
  appearing later is protected exactly as before.

  Found in a real Payload Admin: the failure reproduced three times across
  roughly a thousand browser rounds, always on the one document whose seeded
  quote contained a paragraph break, in both locales.

## 1.8.0

### Minor Changes

- 71c430b: `inspect()` now reports `scheduler.lastFlush.appliedFields`: the field names a
  flush applied, in application order.

  `applied` was a count, and a count cannot separate "this binding was written"
  from "this binding was never scheduled". Both are consistent with a stale
  binding sitting next to a non-zero count.

  This came out of a real diagnosis. A binding stayed stale while two sibling
  fields of the same document updated in the same flush, and the snapshot said
  `applied=3` with only two writes observable in the DOM — connected, nothing
  pending or deferred, gate inactive, no orphan, and (since the previous release)
  no absent field either. Every question the snapshot could answer came back
  clean, and the one that mattered — which three fields those were — could not be
  asked.

  The failure reproduced three times in 320 browser rounds, twice with byte-identical
  counts, so the missing name is a specific field rather than noise.

## 1.7.0

### Minor Changes

- 491d2f9: `inspect()` now reports `bindings.absentFields`: bound fields that an update
  carried no value for.

  A binding whose field is missing from the update is skipped silently — it keeps
  whatever text it already has, and nothing says so. That is the exact opposite of
  `orphanFields` (a value with no anchor), and until now only one half of the pair
  was visible. From the DOM the two indistinguishable cases are "the update never
  arrived" and "the update arrived without this field".

  The gap surfaced while diagnosing an intermittent test failure where one field
  of a document stayed stale while its siblings updated in the same flush. The
  snapshot showed a healthy connection, nothing pending or deferred, an inactive
  visibility gate and no orphan — every question it could answer came back clean,
  because the one that mattered was not being asked.

  Cumulative since start, like `orphanFields`.

## 1.6.0

### Minor Changes

- d8bc7b8: Stop charging every visitor for the editor's runtime. A statically built Astro site has no server to decide per request, so `mode: 'inline'` bakes the whole runtime into every page — around 21 KB gzip that only an editor inside the admin iframe will ever execute.

  `mode: 'loader'` injects a few hundred bytes instead. They run the same preview-context check the runtime would have run, and only when it says yes do they fetch the runtime as a content-hashed asset with an SRI hash. Measured on this repository's Astro fixture: `index.html` drops from 70 314 to 3 151 bytes, per page.

  The asset is configuration-free by design — the bootstrap assigns the config inline, so the file is byte identical for every site on this version. That is what makes it cacheable across pages and deployments, and it is why it cannot carry a deployment secret: there is nowhere for one to go. Its hash and integrity are computed once when this package is built, so a consumer's build does nothing but copy bytes. `astro dev` serves the same path from memory, so a preview behaves identically in development and production.

  The detection is shared with the runtime rather than restated. A second copy would drift, and drift here means a preview that silently never starts.

  The Astro fixture now runs in loader mode, which puts the whole path through the browser matrix in Chromium, Firefox and WebKit. Astro's inline branch is a single `injectScript` call covered by unit tests, and the inline _runtime_ is still driven end to end by the Next.js, SvelteKit and Nuxt fixtures.

## 1.5.0

### Minor Changes

- 8cbe510: Give every diagnostic a stable code. Prose gets reworded; a code does not, so a log filter, an alert rule, or a bug report that names `LP0301` keeps meaning the same thing after the sentence around it is rewritten — and a code is greppable in a way a sentence fragment is not.

  Fourteen codes cover what the runtime reports today, grouped by the question they answer: configuration and origin trust (`LP01xx`), bindings and markup (`LP02xx`), scheduling (`LP03xx`), rendering (`LP04xx`), messages (`LP05xx`), and consumer callbacks (`LP06xx`). Every warning now prints its code, and the `error` event carries `code` alongside the existing `context` — branch on `code`, read `context` for the human-readable origin. `DIAGNOSTIC_CODES` is exported so consumers can name a code instead of copying a literal.

  A test holds the registry against the source tree in both directions: no code is emitted that the registry does not define, and no registry entry exists that nothing reports. `LP0604` is reserved rather than assigned, because a throwing token validator is deliberately treated as a rejection and reported as `LP0502` — there is nothing distinct to report yet, and the number stays reserved rather than being handed to something else.

- a28e955: Let a running preview explain itself. `inspect()` returns a point-in-time snapshot of what the runtime actually sees — bound and orphaned fields, the document owners on the page, the origin it locked onto, revisions accepted and superseded, the negotiated protocol, and the scheduler's pending and deferred work with the visibility gate's threshold and whether it is currently deferring. It performs no I/O and transmits nothing.

  It is reachable where the failures happen: `__livePreview.inspect()` on the global handle every adapter injects, and `client.inspect()` for consumers driving the runtime themselves. Shipping diagnostics to the programmatic client alone would repeat the mistake that made `bindNavigationLifecycle()` unreachable for adapter users in 1.3.0.

  The snapshot is not gated to development builds. It discloses nothing that is not already on the page — the trusted origins are inside the injected script, the field names are `data-payload-field` attributes in the DOM — and a preview that only misbehaves on the deployed site is exactly the case where the information is worth having.

  Fixed along the way: the protocol negotiation compared only the negotiated version, so a remote party announcing version 1 left `protocol.theirs` as `undefined`, indistinguishable from one that never announced at all.

- 73be6a3: Add `pll doctor`, an audit of what a deployment actually serves. `inspect()` answers "what is this runtime doing right now" from inside the page; the doctor answers the question one step earlier, from outside it.

  `npx pll doctor <url> --admin <origin>` fetches the URL twice — once as an ordinary visitor, once with the headers the admin's iframe sends — and reports the difference. That comparison is the whole design. A configuration file can say `allowedOrigins: [...]` while a proxy strips the header, an adapter runs in an inject mode nobody remembers choosing, or a build emits binding attributes on public pages; the gap between what a project believes it is configured to do and what it puts on the wire is where this package's most expensive findings have lived.

  Verified against a real same-origin consumer before release, which immediately paid for itself: the first run produced three findings and all three were wrong for that topology. `'self'` in `frame-ancestors` does name the admin when admin and site share an origin, `X-Frame-Options: SAMEORIGIN` does permit that framing, and a missing inline runtime is expected when the consumer starts `LivePreviewClient` themselves. All three are corrected and pinned by regression tests; a missing runtime is now a warning that names both readings rather than an error that assumes one.

  Seven checks, each stamped with a code: no runtime in the preview response, a missing `frame-ancestors` or one that excludes the admin origin, an `X-Frame-Options` that no CSP can undo, binding attributes served to anonymous visitors, more bindings than the visibility gate writes eagerly, bindings outside every owner marker, and a runtime with nothing to write into. Exit code 2 on any error-level finding, so it drops into CI against a deploy preview; `--json` emits the report as data.

  `analyzeProbe()` is exported from `payload-live-preview/doctor` for callers who fetch the responses themselves — the judging is pure, and only the fetching lives in the CLI. The audit makes exactly the two requests it is told to make, sends no credentials, and reports no telemetry.

## 1.4.1

### Patch Changes

- fd69bde: Make the document lifecycle reachable for adapter users. 1.3.0 shipped `bindNavigationLifecycle()` on the programmatic client, but every adapter injects the inline runtime — a separate build that never carried it — so an Astro, Next, SvelteKit or Nuxt consumer using the documented path got none of it and a back/forward-cache restore still left the preview silently dead. The inline runtime now binds `pagehide` and a persisted `pageshow` itself and releases them on `destroy()`. Soft navigation stays unbound, because only the host knows which event its router fires.
- 652183e: Put the Nuxt adapter under the same browser evidence as the others. Nuxt shipped an adapter but no real-app fixture, so its coverage claim rested on unit and integration tests while Astro, Next and SvelteKit were each driven through a real browser and a real iframe. `examples/nuxt-payload` now runs the Nitro plugin against the same mock admin and the same markup as the other fixtures, and the E2E matrix asserts DOM patching, plain-text XSS handling, preview-only injection and origin enforcement across Chromium, Firefox and WebKit. No runtime code changed — the README simply no longer claims more for Nuxt than was measured, or less.

## 1.4.0

### Minor Changes

- e6b332e: Publish which schema fields a binding can actually address. `pll-codegen --inventory <path>` writes every addressable field as JSON — spelled the way the runtime resolves it — and `checkPreviewBindings()` cross-checks bindings a consumer has already extracted, reporting unknown slugs and fields that no longer exist. The path convention is the part worth publishing rather than documenting: structural containers (`tabs`, `row`, `collapsible`) contribute no segment, arrays address items through `.*`, and blocks through `.*.<slug>`. Markup extraction stays with the consumer, because resolving a binding expression in Astro, JSX or Svelte is framework work this package cannot do generically.

## 1.3.0

### Minor Changes

- b15eb33: Own the document lifecycle instead of leaving it to every integration. `LivePreviewClient` gains `suspend()` and `resume()`, and `bindNavigationLifecycle()` wires them to `pagehide` and a persisted `pageshow`. A back/forward-cache restore does not re-run module scripts, so a client that stays attached across `pagehide` comes back bound to a document the browser froze and thawed, and silently stops updating. Unlike `destroy()`, a suspension keeps plugins, renderers and transforms, so the same client comes back. Soft-navigation cache rebuilds are opt-in per event name, because the package cannot know which framework is present.

## 1.2.2

### Patch Changes

- a1afc20: Report the first flush the visibility gate holds back. The scheduler stops writing offscreen elements once the binding cache exceeds `visibilityGateThreshold` (default 50) and buffers them until they scroll into view; nothing said so, and the symptom — a page that stops updating below the fold the moment it crosses the threshold — is indistinguishable from a broken runtime. Behaviour is unchanged: the knob already existed, it was simply invisible, and the one code path that saw the deferral returned early on the flushes worth reporting.
- dc2b6da: Stop the release-critical mutation gate from failing on measurement noise. The baseline was compared exactly, so a single mutant that survives on one machine and dies on another moved the second decimal and turned scheduling luck into a red release. The policy can now declare how many flipped mutants count as noise; drift inside that band is reported for diagnosis and no longer fails the run, while a drop below the band is still a regression and a gain above it still demands a ratchet. Policies that declare no band keep comparing exactly.

## 1.2.1

### Patch Changes

- 41f2b1a: Wait for npm to actually serve a freshly published version instead of failing the release on the first read.

  npm acknowledges a publish before the new version is readable, and every read the release performs afterwards happened exactly once. All three 1.0.x releases published correctly and then went red: 1.0.5 and 1.1.0 could not observe the version at all, and 1.2.0 saw the metadata but got `ETARGET` when downloading the tarball. Each left the git tag and the GitHub release unmade until the job was re-run by hand.

  Both post-publish reads now retry within a bounded budget — three minutes at five-second intervals — and the first attempt is never delayed, so a registry that is already consistent costs nothing. Only the shapes npm uses while propagating (`ETARGET`, `E404`, `notarget`) are retried; every other failure still fails immediately, so waiting can never mask a real fault.

## 1.2.0

### Minor Changes

- 7dec677: Add `createPreviewBindings()`, an authorization-gated emission unit for binding attributes, so a public response can carry no `data-payload-*` at all.

  Binding attributes are not neutral markup. `data-payload-field` names a CMS field and `data-payload-owner` names a global, a collection and often a document id, so emitting them unconditionally publishes the shape of the content model — and the identity of documents — to every anonymous visitor and crawler.

  The gate itself stays with the application: it is the same verified decision that already controls draft reads and cache policy. What the package now provides is a place to apply that decision once per request, so no individual call site can forget it, and an emission unit that cannot be partially suppressed. While unauthorized, `bind`, `bindByPath` and `owner` all return an empty attribute set.

  That indivisibility is the substantive part. A field travels with its type, locale, rich-text marker and owner; gating only the field name leaves the companions behind, which discloses the taxonomy anyway and leaves the runtime looking at a binding whose field is gone. `BindOptions` therefore gained `richtext`, `html` and `locale`, the companions that previously had to be hand-written as literals next to a gated field.

  The README documents both the gate and a trap it exposes: consumer CSS keyed on `data-payload-*` couples public layout to preview state, so gating emission silently changes what anonymous visitors see.

- a8a972f: `buildLivePreviewUrl` can now decline a document instead of always producing a URL.

  The callback returned `string`, so "this document has no preview target" was unexpressible. A draft without a slug, a collection that is never rendered, a document with no id — each of them fell through to the fallback path and pointed the preview iframe at an unrelated public page. Payload's own `url` callback accepts `null` for precisely this case and then shows no iframe. Consumers were writing guards around the helper to recover that.

  A resolver may now return `null`, and `fallback` accepts `null` to decline every unmapped document. Both forms stay distinguishable at the type level: with string-only resolvers and a string fallback the callback keeps its 1.0 signature and always produces a URL, while using `null` anywhere widens the return type to `string | null`. Existing configurations are unaffected in behaviour and in type.

  An empty string keeps its 1.x meaning and falls back, and a slug mapped explicitly to `null` is now treated as a resolver in its own right rather than as an absent entry.

## 1.1.0

### Minor Changes

- bc21563: Add opt-in document ownership for bindings, so one page can preview several documents without them competing for the same field name.

  A binding's identity was its field path alone. On a page that renders a page global, shared metadata, and a list of collection rows, a field called `title` in any of them matched every `title` on the page, and an update meant for one overwrote all of them. Payload already sends the edited document's identity on every message; the runtime simply never correlated it with the DOM.

  Declare ownership in markup with `data-payload-owner`, resolved from the nearest marked ancestor (the element itself included) so a shell component can own a region without repeating the marker and a nested document can override what it would inherit. The grammar is `global:<slug>`, `collection:<slug>`, or `collection:<slug>:<id>`.

  Enable enforcement with `scopeBindingsByOwner` on `LivePreviewClient` or `generateInlineScript()`. It defaults to `false`, so existing pages keep matching on the field name exactly as before. While enabled, an update reaches only the bindings owned by the document it names, a binding without an owner is never updated, an exact document marker stays unreachable while the message carries no document id, and a message naming neither a global nor a collection changes nothing and warns once. Orphan-field diagnostics became owner-aware, so another document's fields are no longer reported as missing anchors.

  Owner changes are observed like every other binding attribute, including on an ancestor that carries no binding of its own.

## 1.0.5

### Patch Changes

- 6cdea3b: Preserve `ready: true` as a boolean in the minified inline runtime handshake so strict Payload protocol consumers can establish live preview reliably.

## 1.0.4

### Patch Changes

- adeda09: Make live-preview updates revision-safe, discard stale asynchronous work across lifecycle generations, and report only DOM changes that were actually applied.

  Apply plugin transforms consistently, restore layered renderers on teardown, and release every listener, transform, renderer, and cleanup registered through a plugin context. Harden Payload message, merge-path, CSP, and preview-boundary validation while clarifying that preview intent is not authorization.

  Isolate shared accessibility resources across clients while preserving adopted consumer DOM, make binding-cache updates atomic, observe all binding metadata, and keep consumer diagnostics from interrupting event dispatch, updates, fallbacks, or teardown. Apply structural-array DOM changes synchronously so completion events describe real writes and destroyed clients cannot receive deferred transition callbacks. Preserve literal template values, including JavaScript replacement metasequences, and support injected sanitizer documents in Node without browser globals.

  Reconcile SSR-seeded structural arrays without duplicate children, keep mixed keyed moves and updates in final-data order, refresh top-level and nested template metadata, and preflight the complete nested tree so invalid deep markup cannot partially mutate live DOM. Create structural roots through their container document. Built-in no-write paths no longer emit successful update events, while existing custom renderer and scheduler callback return values retain their 1.x semantics.

  Roll back partial runtime startup across observers, message listeners, caches, accessibility leases, ready timers, and inline global-handle publication so transient browser failures can be retried on the same runtime or client; contain later ready-retry transport failures.

  Make timers, animation frames, observers, message listeners, accessibility nodes, and merge attempts retain exact ownership across ineffective cancellation and re-entrant host callbacks. Stale callbacks can no longer clear or publish newer work, and hostile or asynchronous consumer callbacks remain fail-soft without escaping as unhandled rejections.

  Keep consumer installs free of package lifecycle build scripts, preserve the established 1.0.x inline-runtime presence marker, and add isolated strict exact-tarball, export, CLI, type, bundle, and release-after-CI gates that cannot inherit maintainer dependencies; remove unreachable CommonJS artifacts and redundant built-in registrations.

  Minify the narrow `core` entry independently while retaining every callable public export name, declaration, source map, and ESM/CJS condition; the bundle gate now verifies that full callable namespace instead of a hand-picked subset.

  Turn the test environment into an executable quality contract: fail on flaky, skipped, focused, conditional, retried, repeated, or stale-inventory tests; ratchet global, critical-file, and changed-line coverage; enforce dependency layers, cycles, dead code, immutable workflow actions, and exact release-job requirements. Validate the exact package archive with API Extractor reports, positive and negative NodeNext type contracts, publint, ATTW, declaration-condition parity, isolated consumers, and a reviewed public-type-debt ratchet.

  Promote the exact CI-verified npm archive instead of rebuilding at publish time. Bind it to a reproducible commit timestamp and a digest/content manifest, recheck the downloaded workflow artifact, and verify the registry-served bytes before creating the release tag.

  Add Stryker mutation profiles and deterministic fast-check security/lifecycle models, including scheduled high-volume exploration. Add CodSpeed trend collection, WCAG 2.2 AA Axe checks, a 10,000-update forced-GC Node resource gate, and a sustained Chromium update/heap soak, with all expensive exploratory checks separated from the deterministic pull-request lane.

## 1.0.3

### Patch Changes

- Real-Payload protocol coverage + validation robustness.

  - **New contract test** (`tests/integration/real-payload-protocol.test.ts`)
    runs a message captured **verbatim from a running Payload 3.85 admin**
    through the real MessageBus + runtime, asserting text, rich-text
    (real Lexical) and array rendering. This closes the gap the emulated
    E2E fixture left open — "does the runtime handle the shape Payload
    actually sends?" — and documents the layered protocol coverage in the
    README.
  - **Guard robustness:** optional scalar fields now treat `null` the same
    as absent. A real global sends `collectionSlug: undefined`; a JSON
    round-trip or proxy can turn that into `null`. Both are accepted
    rather than dropped as malformed.

## 1.0.2

### Patch Changes

- Hardening from an external code review — closes five real gaps where
  the implementation was weaker than its own comments/docs claimed:

  - **Message validation is now genuinely strict.** A `payload-live-preview`
    message whose `data` is a non-object (string/array/number) was
    previously accepted; a full per-type guard now rejects it (and
    wrongly-typed scalar fields) as `onInvalid('shape')`. The runtime
    enforces `data?: Record<string, unknown>` instead of only asserting it.
  - **Async preview-token validation is serialised in arrival order.**
    Verdicts were dispatched independently, so a slower validation could
    let a later update overtake an earlier one. They now run through a
    single ordered chain.
  - **`destroy()` clears `window.__livePreview`.** It was left pointing at
    the dead API, so a later `bootstrapInlineRuntime()` returned the
    destroyed instance and never restarted. The handle is now removed on
    destroy, so re-bootstrap starts a fresh runtime.
  - **Structural-diff state is genuinely per-instance.** The
    `structural-array` renderer's diff memory (previous values + nested
    store + warning set) moved from module-level `WeakMap`s into
    per-`buildBuiltinRenderers()` closures, so two clients never share
    state and a destroyed client leaves nothing at module scope — making
    the "no module-level singletons" guarantee literally true.
  - **Docs aligned to the code.** The message-bus, structural-applier and
    README/security claims now describe exactly what the implementation
    does.

  No public API changes. New regression tests cover each fix (malformed
  `data` drop, out-of-order async-validation ordering, destroy→rebootstrap,
  and two-instance diff isolation).

## 1.0.1

### Patch Changes

- Provenance-signed maintenance release. No runtime changes since 1.0.0 —
  1.0.0 was published locally (without provenance) to bootstrap the
  package; this release is published through the GitHub Actions pipeline
  with a signed provenance attestation ("published via GitHub Actions" on
  npm) and verifies the automated release chain end-to-end. The CI test
  matrix now also covers Node 26.

## 1.0.0

### Major Changes

- 47bb367: Complete rewrite toward `1.0.0`. Highlights:

  - **Single source of truth**: the inline runtime is now compiled from
    `src/core/runtime.ts` at build time. The `LivePreviewClient` and the
    inline script share every primitive — no more parallel
    implementations to drift out of sync.
  - **Schema-driven engine**: parses Payload's `fieldSchemaJSON`, walks
    arrays/blocks/groups/tabs, and applies id-keyed structural diffs with
    optional View-Transitions animation.
  - **Complete Lexical renderer**: 16 node types including `upload`,
    `relationship`, `block`, `autolink`, `tab`, indent, RTL.
  - **Per-instance architecture**: every primitive is a class; no
    module-level singletons. `destroy()` only affects the calling
    instance.
  - **Adapters**: first-class Astro integration (auto-inject script,
    CSP-managing middleware, `renderLivePreviewScript`), Next.js,
    SvelteKit, Nuxt — all share the same core.
  - **Security**: 100% security-module coverage. Pattern-based
    localhost matcher, handshake-verified origin lock, CSP nonce +
    `'strict-dynamic'` recipe, expanded sanitizer with `<img>`,
    `<figure>`, `<video>`, attribute-safe URL escape, prototype-pollution
    guard.
  - **DX**: strict TypeScript with `exactOptionalPropertyTypes` /
    `noUncheckedIndexedAccess`, ESLint strict-type-checked, vitest with
    95%+ coverage thresholds, Playwright matrix for chromium/firefox/webkit.

  `0.1.0` consumers should follow the migration guide
  (`docs/migration.md`). The public surface has changed materially.

- 912f219: Payload 3.x compatibility and public-release hardening:

  - **REST data merging** (`serverURL` / `apiRoute` / `mergeDepth`):
    updates are re-fetched through the Payload REST API so relationship
    and upload fields render populated — the same strategy as the
    official client. Payload 3.x sends raw form values only.
  - **Fixed head-inline injection**: the runtime now defers startup to
    `DOMContentLoaded` when executed while the document is parsing.
    Previously the Astro integration's injected script crashed on
    `document.body === null` and live preview never started.
  - **Heartbeat disabled by default** (`heartbeatMs: 0`): the Payload
    admin sends no keepalive, so the previous 30 s idle timeout produced
    false disconnects while editors paused typing.
  - **Preview-gated injection**: server adapters now inject only into
    preview requests (`?preview=true` / `?draft=true`,
    `Sec-Fetch-Dest: iframe`, admin referer) by default; use
    `inject: 'always'` for the old behaviour. Fragment responses without
    `<head>` (server islands) are skipped, Astro ≥ 5 prerendering is
    skipped, immutable response headers are tolerated.
  - **CSP defaults fixed**: adapters manage only `frame-ancestors` by
    default (union-merged into any existing policy instead of clobbering
    it). Full `script-src` nonce management is opt-in via
    `manageCsp: 'full'`; `'strict-dynamic'` is opt-in via
    `strictDynamic: true` because it disables `'self'`/host sources and
    broke framework hydration scripts.
  - **Nuxt adapter is now real**: `livePreviewNitroPlugin()` hooks
    `render:html`, injects the script, and merges CSP.
  - **Lexical auto-detection**: rich-text values bound with a bare
    `data-payload-field` render as rich text — `data-payload-richtext`
    is no longer required.
  - **`data-payload-attribute` implemented** with a policed writer
    (event handlers, `style`, `srcdoc`, `formaction`, `id`/`name`
    refused; URL attributes validated). Previously the DSL emitted the
    attribute but the runtime ignored it.
  - **New composable server helpers**: `isPreviewRequest()`,
    `mergeCspHeader()`; `documentSavePlugin` is now actually exported.
  - **Security hardening**: `srcset` candidate URLs validated,
    `lexicalToHtml` honours `setSanitizerDocument()` during SSR,
    protocol-relative external links get `rel="noopener noreferrer"`,
    `<` escaped in the inline config, production warning when origin
    trust rests on `document.referrer` alone.
  - **Protocol honesty**: `previewToken` / `protocolVersion` are
    documented as library extensions (stock Payload sends neither);
    `payload-document-event` and `externallyUpdatedRelationship` typed
    to match the real wire format.
  - Astro peer range is now `>=4.0.0 <8.0.0`. The maintained real-app
    browser fixture currently exercises Astro 7; the peer range is broader
    than that single-major E2E fixture.

  Additional hardening from the pre-release competitive audit:

  - **Referrer trust is now a fallback, not a union member**: once
    explicit `allowedOrigins` are configured, `document.referrer` can no
    longer widen the allow-list (previously a foreign embedder could be
    trusted alongside the pinned admin origin).
  - The inline runtime no longer constructs `new Function` (CSP `eval`)
    — the `import.meta.env` probe is compiled out of the IIFE.
  - Honest Next.js/Nuxt guidance: DOM patching targets server-rendered
    markup; client-rendered React/Vue trees should use the official
    `@payloadcms/live-preview-react`/`-vue` hooks. The Next.js middleware
    is documented as CSP-only (it cannot inject into `NextResponse.next()`).
  - New `payload-live-preview/payload` entry:
    `buildLivePreviewUrl()` generates the `admin.livePreview.url`
    callback from declarative slug → path maps.
  - `mergeFetch` option on `LivePreviewClient` (equivalent of the
    official `requestHandler`) for auth headers / custom proxies.
  - Weekly protocol-watch CI job asserts the wire-format invariants
    against `@payloadcms/live-preview@latest`.
  - Node engines raised to `>=20.19.0` (Node 18/20 are EOL); toolchain
    moved to TypeScript 5.9, Vitest 4, ESLint 10, jsdom 29, esbuild 0.28.

### Minor Changes

- Feature completion for 1.0:

  - **`<RichText />` Astro component** (`/astro/RichText.astro`): SSR-renders
    Lexical fields through the SAME renderer the runtime uses for live
    patches — markup cannot diverge — and emits the binding plus the
    empty-anchor pattern automatically. `registerBlockRenderer` is now
    exported from the main entry for custom block markup.
  - **Draft-first initial loads**: `fetchPreviewDocument()` /
    `fetchPreviewGlobal()` wrap the REST query with draft, depth, locale and
    auth headers. Security clarification: `isPreviewRequest()` detects only
    client-controlled preview intent. Authorize the request with an
    application-owned session or short-lived scoped signature, then pass
    `draft: authorization !== null` and only that authorization's minimum
    request-scoped credentials.
  - **Astro integration `mode: 'middleware'`**: auto-registers the
    preview middleware via `addMiddleware()` + a virtual options module —
    request-time, preview-intent-gated injection for `output: 'server'`
    projects without a hand-written `src/middleware.ts`.
  - **Scroll-preserving reload** in `documentSavePlugin`: the `'reload'`
    strategy (and the revalidate-failure fallback) now restores the
    scroll position after the refresh.
  - **`previewSignals` option** on `isPreviewRequest` and every adapter:
    restrict preview detection to `['query']` for setups that must never
    relax framing headers for unsolicited iframe loads.
  - **Real Next.js and SvelteKit example apps** under `examples/`, both
    E2E-tested (Chromium/Firefox/WebKit) alongside the Astro app —
    51 E2E tests total.
  - **Protocol watch extended to Payload canaries** (4.0 pre-releases)
    as a soft-fail early-warning lane.
  - Benchmarks suite (`npm run test:bench`) with published numbers in
    `docs/benchmarks.md`.
