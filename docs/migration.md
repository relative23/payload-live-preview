# Migration guide

## Upgrading to 3.0

3.0 removes what 2.x deprecated, changes the defaults in the table below, and
runs on Node 24 with Payload 3.90.0 or newer, or Payload 4. Take the upgrade in
this order:

1. Bring the project to [what 3.0 runs on](#what-30-runs-on).
2. List the places 3.0 changes: `npx pll doctor --v3 ./src`.
3. Let the codemods rewrite what they can: `npx pll migrate ./src --write`.
4. Go through what is left with [the table](#what-changed-and-what-to-write).
5. Start the project. A name that is gone fails the import or the type check,
   and [what a JavaScript config still passes](#what-30-refuses-at-startup) is
   refused at startup with the reason.

The ADR 0007 ledger has every row with its reasoning.

### What 3.0 runs on

|               | 3.0                                                        | When the project cannot move yet                                                           |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Node          | 24 or newer                                                | the 2.x line runs on Node 20.19 and newer                                                  |
| Payload       | 3.90.0 or newer, and 4.x (`>=3.90.0 <4.0.0 \|\| ^4.0.0-0`) | update Payload inside its major first; the 2.x line supports Payload 2 and every Payload 3 |
| Astro         | 7.2.8 or newer (`>=7.2.8 <8.0.0`)                          | the 2.x line supports Astro 4 to 7                                                         |
| Next.js       | 15.5 and 16, App Router                                    |                                                                                            |
| SvelteKit     | 3.x                                                        |                                                                                            |
| Nuxt          | 4.x                                                        | update Nuxt with its own upgrade guide first                                               |
| Module format | ESM only, one module graph                                 | nothing to do: `import` and `require()` of an entry keep working                           |

The 2.x line stays the one for Payload 2 ([compatibility.md](compatibility.md))
and gets fixes until 3.1.0 is published ([SECURITY.md](../SECURITY.md)).

### List the places: `pll doctor --v3`

`pll doctor --v3` reads the source and lists every call of the package that 3.0
changes, by ledger row, with file and line. Run it on 2.x before the upgrade or
on 3.0 after it:

```sh
npx pll doctor --v3 ./src
```

```text
Row 26: A hook without `document` merges every update an allowed admin sends; 3.0 requires `document`
  app/hook/HookPreview.tsx:16
  Name the document the page rendered: `document: { collection, id }` or `{ global }`.

Row 27: A merge without a deadline gets one of 10 000 ms
  app/hook/HookPreview.tsx:16
  app/layout.tsx:68
  Set `mergeTimeoutMs` (`timeoutMs` on a hook) to the deadline you want, or to `0` to keep none.

3 place(s) in 2 row(s); 10 file(s) use the package.
```

It knows the rows a call can show:

- `setSanitizerDocument()` (row 16) and `lexicalToHtml()` without a document
  (row 18).
- `defaults: 'v1'` (row 21), which `pll migrate` then writes out, and
  `strict: false` (row 36).
- `new OriginDetector()` without `enableReferrerDetection` (row 22).
- A hook or `createDocumentSession()` without `document` (row 26), and one with
  a `locale` in its document and no `requireLocale: true` (row 31).
- A merge without a deadline (row 27): a hook without `timeoutMs`, and an
  adapter, `generateInlineScript()` or `initLivePreview()` that sets
  `serverURL` and no `mergeTimeoutMs`.
- `livePreviewScriptProps()` without `delivery: 'asset'` (row 32) and the Astro
  integration without `mode` (row 33).
- An integration, an adapter or `generateInlineScript()` given `runtime`, the
  lean artifact (row 37).

It reads options that are written at the call, in a `const` of the same file,
or in a `const` that a relative import names, and it reads both sides of a
condition such as `...(cms ? { serverURL: cms } : {})`. A call whose options
come from anywhere else (another package, an alias path, a function call) is
listed under "Not read", so an empty list never says more than it read. It
follows a name the file imports by name (`import { … }` or a destructured
`require()`), so it does not read a namespace import, JSX elements, component
templates or the `livePreview` key of `nuxt.config`; the notices above cover
those at run time.

The exit code is 3 when it lists a place and 0 when it lists none; `--json`
prints the same report as data. It changes no file, and it needs `ts-morph`,
as `pll migrate` does.

### Rewrite what a codemod can: `pll migrate`

```sh
npx pll migrate ./src            # dry run: lists the files and codemods it would change
npx pll migrate ./src --write    # apply them
```

It runs every codemod it has, and each one counts here, since 3.0 removes the
names 2.0 deprecated: `rename-is-preview-request`,
`rename-admin-origins-option`, `rename-bindings-authorized-option`,
`move-fetch-preview-helpers`, `rename-on-unbound-change`,
`rename-disable-switches` and `expand-defaults-v1` for names and options, and
`move-payload-entry`, `move-core-entry`, `move-plugins-entry` and
`move-structural-entry` for the entries that merged. What it cannot rewrite
safely it lists as `file:line` and leaves as it stands, and it exits `3` when a
place needs a person. [Run the tooling first](#run-the-tooling-first) has the
rules each codemod follows.

### What changed, and what to write

| 3.0 change                                                                     | What to write                                                                                                                                                                     | What to do                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lexicalToHtml()` without a sanitizer document throws instead of warning       | `lexicalToHtml(content, { requireDocument: true })`, `<RichText requireDocument />`                                                                                               | pass a `document` (linkedom, jsdom) per call; the build names every render without one                                                                                                                                                                                     |
| a partly bound group counts as covered path by path                            | `subfieldCoverage: 'declared'`                                                                                                                                                    | LP0203 names each uncovered path; declare the ones the page leaves out on purpose with `data-payload-covers`                                                                                                                                                               |
| `setSanitizerDocument()` is removed                                            | pass `document` per call                                                                                                                                                          | `sanitizeHtml(html, { document })`, `lexicalToHtml(content, { document })`, the `RichText` `document` prop                                                                                                                                                                 |
| `defaults: 'v1'` is removed                                                    | `npx pll migrate ./src --write`                                                                                                                                                   | the rows it stood for become explicit options with the same values, except `strict: false` and `'referer'` among the preview signals, which 3.0 cannot keep; `pll doctor --v2` names the rows that are left                                                                |
| `strict: false` is removed                                                     | pass `authorizePreview` and remove the option                                                                                                                                     | no response changes on intent alone; an adapter given `strict: false` refuses to start ([authorization.md](authorization.md))                                                                                                                                              |
| the lean runtime (`LEAN_RUNTIME` and the `runtime` option) is removed          | delete the import and the option                                                                                                                                                  | one runtime; for fewer bytes on a visitor's page deliver it as an asset (`delivery: 'asset'`, Astro's `mode: 'loader'`)                                                                                                                                                    |
| `onUnboundChange`, `isPreviewRequest()` and `adminOrigins` are removed         | `npx pll migrate ./src --write`                                                                                                                                                   | the codemods rename them: `onUnfaithfulPatch` (`'route'` is `'escalate'`), `hasPreviewIntent()`, `allowedOrigins`                                                                                                                                                          |
| the `disable…` switches are named by what they turn on                         | `npx pll migrate ./src --write`                                                                                                                                                   | `enableVisibilityGate`, `enableReferrerDetection` and `enableLocalhostMatching`, each with the value turned round; the codemod rewrites a literal `true` or `false` and lists any other value                                                                              |
| the `signed-token` replay store `{ isUsed, markUsed }` is removed              | implement `consume(id, expiresAt)`                                                                                                                                                | one check-and-record step; [security.md](security.md) has a Redis example                                                                                                                                                                                                  |
| `new OriginDetector()` no longer trusts `document.referrer` by default         | `new OriginDetector({ enableReferrerDetection: false })`                                                                                                                          | pass `enableReferrerDetection: true` where a detector you build yourself relies on the referrer                                                                                                                                                                            |
| a route refresh that returns nothing is no longer taken as committed           | return a promise that settles after the host's commit; `LP0810` names a refresh that returns no promise, under `debug`                                                            | `LivePreviewNavigation` (Next.js), `livePreviewNavigation()` (SvelteKit) and the Nuxt module's client plugin do it; a host that renders synchronously returns `Promise.resolve()`                                                                                          |
| the `@internal` names the entries exported at run time are gone                | nothing: `VERSION`, `generateCspNonce()` and `isLexicalContent()` were among them and are public now                                                                              | stop importing the others; `etc/api/*.api.md` of 2.5 lists every one, and the import or the type check names it                                                                                                                                                            |
| Payload 2.x is no longer supported                                             | 2.x releases keep supporting it; Payload 3.90.0 and newer and 4.x are what 3.0 supports                                                                                           | upgrade the CMS to Payload 3 with Payload's own migration guide; the frontend options stay as they are                                                                                                                                                                     |
| an update with `fieldSchemaJSON` is refused (`LP0504`)                         | a sender of your own leaves the field out; set `data-payload-type` on a binding that took its type from the schema, and a custom renderer reads `allFields`, not `context.schema` | only a Payload 2 admin sends the field; the schema types (`PayloadFieldSchema` and its two companions), `RenderContext.schema`, the option labels of the `select` renderer and the `fieldTyping` and `populatesRelationships` labels of `ProtocolProfile` are gone with it |
| a hook has to name its document                                                | `document: { collection, id }` or `{ global }` on `useLivePreviewDocument()`                                                                                                      | a hook without `document` does not start; with it, a second hook on the page stops showing the first one's document. `document: 'any'` follows whichever document the admin sends, as every hook did in 2.x                                                                |
| a hook with a `locale` leaves alone an update that names no locale             | `requireLocale: true` on the hook in 2.4 and 2.5; Payload 3 and 4 name the admin's locale in every update when the config has localization                                        | where the admin sends updates without a locale, leave `locale` out of `document`; `requireLocale: false` is refused                                                                                                                                                        |
| a merge has a deadline of 10 s by default                                      | `mergeTimeoutMs` in the runtime, `timeoutMs` on a hook                                                                                                                            | a stalled Payload API shows up as a reported failure, not as an update that never arrives; set a higher value where the server answers slowly, or `0` for none                                                                                                             |
| a hook listens to the admin that spoke first                                   | nothing to set                                                                                                                                                                    | with several `allowedOrigins`, a hook takes updates from the origin whose update it accepted first and refuses the others until it stops listening, as the inline runtime does                                                                                             |
| the Next.js, SvelteKit and Nuxt adapters hand the route to the router          | `routeStrategy: 'after-save'` with `LivePreviewNavigation` or `livePreviewNavigation()` in place is the nearest 2.x setting                                                       | after a save, a change no patch can show refreshes the route through the router refresh the page lent; a page that lent none is told once (LP0808). `routeStrategy: false` keeps none                                                                                      |
| an explicit `routeStrategy` goes through the router too on these three         | render `LivePreviewNavigation` or call `livePreviewNavigation()`; the Nuxt module does it                                                                                         | `true` and `'after-save'` no longer fetch and morph a page a framework hydrates; without a lent refresh the page is left as it is and LP0808 says so                                                                                                                       |
| the entry of `buildLivePreviewUrl()` merged into `payload-live-preview/plugin` | `npx pll migrate ./src --write`                                                                                                                                                   | the codemod rewrites the import; `buildLivePreviewUrl()` and its types keep their names                                                                                                                                                                                    |
| the doctor and migrate entries are no longer importable                        | run the binary: `pll doctor <url> --json`, `pll migrate <path>`                                                                                                                   | the checks and codemods stay in the `pll` binary; an import of either entry does not resolve                                                                                                                                                                               |
| the core, plugins and structural entries merged into `/client`                 | `npx pll migrate ./src --write`; split an import the codemod reports                                                                                                              | `/client` has every name that runs in a browser, the root those and the server's; an import mixing both kinds from the core entry is reported                                                                                                                              |
| the package is ESM-only, one module graph                                      | nothing: `import` and `require()` of an entry keep working on Node 24                                                                                                             | a file under `dist/` is not an entry; import by the entry's name. A page that loads an entry without a bundler serves it with the chunks it imports: the `dist/` folder, not one copied file                                                                               |
| an authorized context is the object the package made                           | pass the context itself, never a copy                                                                                                                                             | `AUTHORIZED_PREVIEW_BRAND_KEY` is gone; a frozen copy and a hand-built object are refused                                                                                                                                                                                  |
| Node 24 or newer                                                               | run the build and the server on Node 24                                                                                                                                           | Node 20 reached end of life on 2026-04-30 and Node 22 follows on 2027-04-30; 2.x runs on Node 20 to 26                                                                                                                                                                     |
| the `payload` peer range drops `^2`                                            | nothing, beyond the Payload 2 row above                                                                                                                                           | 3.0 takes Payload 3 and 4, and Payload 5 arrives in a 3.x minor.                                                                                                                                                                                                           |
| the `payload` peer range begins at 3.90.0                                      | update Payload inside its major to 3.90.0 or newer                                                                                                                                | every Payload 3 release before it carries critical advisories that are patched only there; npm answers `ERESOLVE` beside an older one                                                                                                                                      |
| `payload-session` sends an `Origin` with the cookie from the first request     | `origin` on the strategy, where Payload's `csrf` list does not hold the origin of `serverURL`                                                                                     | one request per check, nothing remembered; the request with the cookie alone served Payload 3.79.0 and older                                                                                                                                                               |
| Astro 7.2.8 or newer                                                           | update Astro; the peer range is `>=7.2.8 <8.0.0`                                                                                                                                  | Astro 4 to 6 get no releases any more and carry a critical advisory that is patched only in 7.2.8; 2.x keeps its range for a project that stays on them                                                                                                                    |
| Nuxt 4                                                                         | update Nuxt with its own upgrade guide                                                                                                                                            | Nuxt 3 reached its end of life on 2026-07-31 and no job runs it any more; the module's code did not change with that, and the guide's snippets are written for the `app/` layout                                                                                           |
| `livePreviewScriptProps()` no longer delivers inline                           | `await LivePreviewScript({ request, ...options })` in the layout, or `delivery: 'asset'`                                                                                          | the component renders nothing for a request it does not authorize; the asset delivery puts a bootstrap in the page; `renderLivePreviewScript()` stays for HTML a server builds as a string                                                                                 |
| the Astro integration delivers through `loader` by default                     | `mode: 'loader'`                                                                                                                                                                  | the page carries a bootstrap instead of the runtime; set `mode: 'inline'` to keep the 2.x delivery                                                                                                                                                                         |

The first three rows are not mechanical rewrites: whether a call site has a
DOM, or which fields a page shows on purpose, is a fact about the project that
`pll migrate` cannot read from the source. The codemods rewrite options that a
file hands to the package, directly or through a `const` it spreads; module
options in `nuxt.config` are not among them, so write the rows out there by
hand.

### What 3.0 refuses at startup

What a JavaScript config can still pass is refused at startup with the reason
and the codemod, in production too: `onUnboundChange` and `defaults: 'v1'` by
the adapters and the generator (the profile by the client as well),
`disableVisibilityGate`, `disableReferrerDetection` and
`disableLocalhostMatching` by all three, `strict: false` by the adapters, a
replay store without `consume` by the first request it would guard,
`livePreviewScriptProps()` without `delivery: 'asset'` by the call, a hook or `createDocumentSession()` without `document` or with
`requireLocale: false` when it is created.
`adminOrigins` is the one that is not refused: it is no longer read.

One refusal comes while a page runs: an update from a Payload 2 admin is
refused with `LP0504`, which the runtime prints once in every build when the
first update with `fieldSchemaJSON` arrives, and which a hook reports as its
state.

### Before the upgrade: what 2.x says

On 2.x each form 3.0 removes warns once per process while it runs in
development, never in production, and names what replaces it, so the server log
lists what is left. Since 2.4 the defaults 3.0 changes say so too, once and
only where the project would see a difference: a detector built without
`enableReferrerDetection` that trusts a referrer, a hook without `document`, a
hook without `timeoutMs`, a hook with a `locale` that merged an update naming
none, an adapter or `generateInlineScript()` without `mergeTimeoutMs`,
`livePreviewScriptProps()` delivering inline, and the Astro integration without
`mode`. The last two name the bytes the project's own pages carry. A page that
relies on the sub-field coverage default is told so once in development. The
first row of the table is the one that also warns in production.

The browser rows go by `process.env.NODE_ENV` as the project's bundler sets it:
a development build speaks, a production build leaves them out together with
their text, and a page that loads the module without a bundler hears none of
them; the server rows speak once per process. A client built in the browser
(`LivePreviewClient`, `initLivePreview()`) does not warn; the codemods cover its
options. The rows that change a surface or a range instead (the route refresh,
the `@internal` names, the Node and Payload ranges) say nothing at run time,
except that `LP0810` names a refresh that returns no promise, under `debug`.

## Upgrading to 2.1

2.1 asks for one change: Astro's `livePreview()` now throws at startup when
`mode: 'inline'` or `'loader'` is given `authorizePreview`, `shouldInject` or
`authorizePreviewModule`. Those modes decide once, at build time, and never
called them, so a configuration that carried one ran on 2.0 with the function
ignored. Use `mode: 'middleware'`, with `authorizePreviewModule` for the verdict
and `previewQueryParams` or `previewSignals` for what `shouldInject` decided, or
register `createLivePreviewMiddleware({ authorizePreview })` in
`src/middleware.ts`. The errors for `authorizePreview` and `shouldInject` name
both ways; the one for `authorizePreviewModule` says it applies to
`mode: 'middleware'` ([Astro](astro.md),
[options.md](options.md), row 24 of the
[ADR 0007 ledger](architecture/0007-v2-defaults-and-renames-ledger.md)).

## Upgrading to 2.0

2.0 flips a table of defaults toward security and performance, renames a few
APIs, and removes the 1.x names. Two tools carry the mechanical part:
`pll migrate` rewrites the renames in your source, and `pll doctor --v2`
audits a served page against the defaults table. In 2.x `defaults: 'v1'`
restored the 1.x table on any adapter, `generateInlineScript()` or
`LivePreviewClient`, so that a site could move one row at a time. 3.0 removed
the profile ([Upgrading to 3.0](#upgrading-to-30)): `pll migrate` writes its
rows into the options, where a single option still moves one row, and the row
"Authorization" below has no 1.x value to go back to.

### Run the tooling first

```bash
npx pll migrate ./src            # dry run: lists the files and codemods it would change
npx pll migrate ./src --write    # apply them
npx pll migrate ./src --only rename-is-preview-request   # one codemod
npx pll doctor https://www.example.com/page --admin https://cms.example.com --v2
```

`pll migrate` needs `ts-morph` — an optional peer, so run `npm i -D ts-morph`
if you do not already have it. It rewrites only names a file binds from
`payload-live-preview`, so an `isPreviewRequest` of your own is left alone.
Anything it cannot rewrite safely — an object shorthand, a re-export, a call
whose options are not a literal — is listed as `file:line` and left as it
stands. The codemods work one by one. `rename-admin-origins-option`,
`rename-bindings-authorized-option`, `rename-on-unbound-change`,
`rename-disable-switches`, `expand-defaults-v1` and the four that move an entry take each spot on its own, so a spot they list does not
stop them from rewriting the rest of the file. `rename-is-preview-request` and
`move-fetch-preview-helpers` make none of their edits in a script that holds a
spot they cannot rewrite: finish that spot by hand and run them again.
`move-fetch-preview-helpers` also leaves a note beside each call it rewrote,
which the CLI lists under manual attention and counts for exit code `3`. A file
that reports a conflict can still have been changed by the others. Exit codes: `0`
nothing needs a human, `1` usage error or missing `ts-morph`, `3` at least one
file needs manual attention. `.astro`, `.vue` and `.svelte` files are rewritten
in their script blocks only; a conflict in one block does not hold back
another. The codemods are `rename-is-preview-request`,
`rename-admin-origins-option`, `rename-bindings-authorized-option`,
`move-fetch-preview-helpers`, `rename-on-unbound-change`,
`rename-disable-switches` and `expand-defaults-v1`, and for the entries that
merged in 3.0 `move-payload-entry`, `move-core-entry`, `move-plugins-entry` and
`move-structural-entry`. The last three send an import to
`payload-live-preview/client`. The core entry also exported `bind()`,
`bindByPath()`, `createPreviewBindings()`, `buildFrameAncestors()`,
`generateCspNonce()` and `isAuthorizedPreviewContext()` with their types, which
a browser entry does not carry: an import of only those goes to the root, and
one that mixes them with browser names is listed for you to split.

`pll doctor --v2` reads the served inline configuration and reports each
runtime row still at its `'v1'` value as `LP0709`. A script names the defaults
it was generated against, so an empty slot counts as that generation's value;
one without the marker — written by 1.x or `2.0.0-beta.0` — is read as 1.x, and
an `info` line says so. It exits `0` with no
error-level findings, `1` if the URL could not be fetched, and `2` on any
error-level finding; it reports redirects rather than following them, so probe
the final URL. The full audit is in
[troubleshooting.md](troubleshooting.md#auditing-a-deployment-pll-doctor).

### The defaults table

Each row is an entry of the readiness table in
[ADR 0007 — 2.0 defaults, migration policy, and the renames ledger](architecture/0007-v2-defaults-and-renames-ledger.md).
The left column is what 1.x did and what `defaults: 'v1'` restored in 2.x; a
single option moves one row, except the first, which 3.0 fixed.

| Row                | 1.x                                | 2.0 default                              | Option                                        | Watch for                                                                                                                                        |
| ------------------ | ---------------------------------- | ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authorization      | response changes on intent alone   | `authorizePreview` required              | `authorizePreview`; `strict: false` until 3.0 | a page that showed preview to anyone now needs a real editor session or token                                                                    |
| Intent signals     | `['query','fetch-dest','referer']` | `['query']`                              | `previewSignals`                              | a flow that relied on the admin referer alone must add `?preview=true`                                                                           |
| Referrer trust     | on                                 | off                                      | `enableReferrerDetection: false`              | same as above                                                                                                                                    |
| Message source     | any origin-valid window            | parent/opener only                       | `eventSourcePolicy: 'parent-or-opener'`       | a custom embedding that posts from another window                                                                                                |
| Unchanged bindings | re-applied                         | skipped                                  | `skipUnchanged: true`                         | a renderer with side effects that expected every message                                                                                         |
| Sanitizer          | `id` and every `data-*` pass       | `id`, `name` and every `data-*` stripped | `sanitizerPolicy: 'strict'`                   | rich text that relies on `id` or `data-*`; a site that enforces Trusted Types also lists `payload-live-preview` in its `trusted-types` directive |
| `allowedOrigins`   | optional                           | required, non-empty, `https:`            | set it explicitly                             | a dev-only origin left implicit                                                                                                                  |
| `mergeDepth`       | `1`                                | required with `serverURL`                | `mergeDepth: <depth of your query>`           | populated relationships degrade to IDs when the depths differ                                                                                    |

### Renamed, moved and removed

`pll migrate` handles the first four:

- `isPreviewRequest()` → `hasPreviewIntent()` — same signature. Through 2.x the
  old name was a deprecated alias on both entries that exported it (the root
  and `payload-live-preview/astro`); 3.0 removed it, and the codemod renames
  it. The renamed
  function keeps the 1.x behaviour too: without `signals` it counts all three
  signals — a preview query parameter, `Sec-Fetch-Dest: iframe` and an admin
  `Referer` — while the adapters' 2.0 default is `previewSignals: ['query']`.
  Pass `{ signals: ['query'] }` where a call should agree with the adapters.
  `pll migrate` prints this as a note whenever it renames the function, dry run
  included; the exit code does not change.
- `hasPreviewIntent(request, { adminOrigins })` → `{ allowedOrigins }` — the
  name everything else uses. 3.0 removed the alias `adminOrigins`: the key is
  no longer read, so the referer signal counts nothing until it is renamed.
- `createPreviewBindings({ authorized })` → `{ authorization }` — pass the
  context from `authorizePreviewRequest()`; the boolean is no longer accepted.
  The codemod rewrites `authorized: false` to `authorization: null`, which
  suppresses every binding exactly as `false` did, and reports any other value
  as a line for a human: only a real verdict authorizes emission, so there is
  nothing it could put there for you.
- `fetchPreviewDocument()` / `fetchPreviewGlobal()` (root) →
  `definePreview({ serverURL, depth }).fetchDocument()` / `.fetchGlobal()`
  from `payload-live-preview/server`; the root helpers are gone, with no alias
  on purpose. They defaulted `depth` to `1` independently of the runtime's
  `mergeDepth`, and a shim would put that mismatch back — the one thing the move
  exists to remove. They and their option types are the six names 1.8.1's root
  entry exported and 2.0 does not; `isPreviewRequest` stayed as the alias
  above until 3.0, and `CAPABILITY_REQUIREMENTS` was not exported by 1.8.1.

Not a codemod target, because TypeScript reports each of them:

- `CachedElement.boundary` is `hidesWhenEmpty` — the `data-payload-boundary`
  anchor that hides itself while its field is empty. Only a custom renderer
  that read the flag is affected.
- The `NextMiddleware` type is gone — use `PreviewAdapterOptions` from
  `payload-live-preview/nextjs`. The `checkFetchDest` option is gone with it;
  `previewSignals` decides which signals count, and `'fetch-dest'` is one of
  them.
- `generateInlineScript()` no longer accepts `nonce`; pass it to
  `wrapWithScriptTag()`.
- If you consume the codemods as a library, `Codemod` no longer carries
  `apply`, so importing its types no longer drags in `ts-morph`. (3.0 removes
  that entry: ADR 0007, row 42.)

Reported by neither:

- `signed-token` `replay: { isUsed, markUsed }` → `{ consume }` — one
  check-and-record step (`true` on first use) instead of a read and a write
  that two simultaneous requests can both slip between. 3.0 removed the
  two-method shape for that reason: a store without `consume` is a
  `PreviewConfigurationError` at the first request. `docs/security.md` has a
  Redis example.
- A script built by hand with `generateInlineScript()` on a page a framework
  hydrates — the 1.x README's Next.js recipe — does not wait for the
  hydration, so the first document can land before it and be undone: React
  regenerates the tree, Vue and Svelte set the value back
  ([ADR 0015](architecture/0015-first-write-after-hydration.md)). Add
  `hydration: 'react'` (`'vue'` on a Nuxt page, `'sveltekit'` on a SvelteKit
  page) to its options, or render the script through the framework's adapter,
  which sets it on every script.
  Measured on a 1.8.1 Next.js app upgraded to 2.0: in development every framed
  load lost its first write until the line was added.

### Before / after

```ts
// 1.x
import { isPreviewRequest, fetchPreviewDocument } from 'payload-live-preview';
if (isPreviewRequest(request)) {
  /* … */
}
const doc = await fetchPreviewDocument({ serverURL, collection });

// 2.0 (after `pll migrate --write`, plus definePreview wiring and the adapters' signals)
import { hasPreviewIntent } from 'payload-live-preview';
import { definePreview } from 'payload-live-preview/server';
if (hasPreviewIntent(request, { signals: ['query'] })) {
  /* … */
}
const preview = definePreview({ serverURL, depth: 2 });
const doc = await preview.fetchDocument({ collection, authorization });
```

### Changes nothing warns about

The rows above announce themselves: a refused preview, a missing binding, a
`pll doctor` finding. These do not. Each one changes output that used to be
correct, so nothing errors and nothing logs — walk this list once against your
own site.

Two of them warn now. `LP0409` names any attribute the strict sanitizer
removes that `'compat'` would have kept — `id`, every `data-*`, and `name` where
`additionalAllowedAttributes` lets `'compat'` keep it — the
first time it happens, with the reason that applies to that attribute. It exists
because this was the one 2.0 change an upgrading project could not discover
except by looking: measured on a real 1.8.1 site, a `data-*` attribute driving a
CSS selector disappeared the moment an editor typed, in the preview only.

`LP0501` does the same for the other default that flipped. `eventSourcePolicy`
is `'parent-or-opener'` since 2.0, where 1.x accepted any window on a trusted
origin, so an arrangement whose admin posts from somewhere other than the window
that framed or opened the page stops updating — and the refusal used to reach
the debug log only. It is now reported once, naming the option. Set
`eventSourcePolicy: 'any'` to keep the 1.x behaviour.

`skipUnchanged` also flipped, from `false` to `true`, and deliberately gets no
report: it skips writes whose value did not change, which is a cost decision
rather than a visible one, and `inspect().revisions.skippedUnchanged` counts
them for anyone who wants the number.

**Rich text markup is classes, not data attributes.** The strict sanitizer
strips `data-*`, so the Lexical renderer emits classes instead:

| Was                                    | Is                                                      |
| -------------------------------------- | ------------------------------------------------------- |
| `data-block-type="hero"`               | `class="lp-block lp-block--hero"`                       |
| inline block attributes                | `class="lp-inline-block lp-inline-block--<slug>"`       |
| relationship attributes                | `class="lp-relation lp-relation--<slug>"`               |
| the built-in blocks                    | `lp-block-callout`, `-image`, `-video`, `-code`, `-cta` |
| inline `style` for alignment or indent | `class="lp-align-<align> lp-indent-<n>"`                |

Block fields are no longer serialized into attributes at all. **Any CSS or
query selector aimed at the old attributes stops matching, silently.** Grep your
styles and your tests for `data-block-type`, `data-payload-` and any attribute
selector on rich-text output before you upgrade. [renderers.md](renderers.md)
lists the full class vocabulary.

**An empty value clears its binding.** Every renderer follows one contract:
an empty value, or a URL the sanitizer refuses, clears the element and counts as
a write, where 1.x left the previous link, text or image in place. A field the
editor empties now empties on the page. `<img>` writes rebuild or remove
`srcset` and `sizes` with the `src`.

**`email` is its own renderer.** It was an alias of `url`, which turned
`someone@example.com` into a relative link. It writes a `mailto:` URL. If you
bound an address with `data-payload-type="url"` to work around that, drop the
override.

**Date inputs get local time.** `date` and `datetime-local` inputs receive the
value in the visitor's time zone, because that is what those inputs mean, and
so does a `time` input bound as a date (`data-payload-type="date"`), as
`HH:MM`. Other
elements still get the ISO instant. A test asserting a UTC string in an input
needs updating; a page that displayed the raw value now shows local time.

**`generateInlineScript({ serverURL })` requires `mergeDepth`.** The client and
the adapters already did; the inline generator was the last one guessing. Pass
the same depth your Payload queries use, or populated relationships degrade to
IDs after the first edit.

## Older versions

Every 1.x minor release was additive; the CHANGELOG lists them. `1.0.0` was a
clean break from `0.1.0`, without an API shim:

- `initLivePreview(config)` keeps its signature, but `allowedOrigins` is
  required whenever neither `document.referrer` nor a localhost origin can
  vouch for the parent.
- The module-level `livePreviewEvents` singleton became `client.events`; each
  `LivePreviewClient` owns its emitter, and plugins receive a per-instance
  `PluginContext`.
- `getFrameAncestors()` became `buildFrameAncestors({ self, origins })`;
  `safeSetTextContent()` was removed (`el.textContent = value` does the same).
- `isSafeUrl('')` returns `false`; the hard-coded `'de'` locale fallback gave
  way to `<html lang>`, then `navigator.language`, then `'en'`.

## From `@payloadcms/live-preview`

What this package shares with the official packages, what it does not, and
how to run both on one page is covered in [interop.md](interop.md).
