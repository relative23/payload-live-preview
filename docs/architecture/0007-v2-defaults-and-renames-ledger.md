# ADR 0007 — 2.0 defaults, migration policy, and the renames ledger

**Status:** Accepted — Shipped in 2.0 • **Date:** 2026-08-27 (started; appended to by every change that renames, moves, re-defaults or removes something)

## Context

2.0 does not add capability. It flips defaults and removes ambiguity. That is
only a safe release if every 2.0 default already exists in 1.x as an opt-in,
is tested in both modes, and has a mechanical migration. A migration tool
written from memory at 2.0 time would miss the small renames; this record is
the ledger it is generated from instead. The 1.9.0 readiness audit fixed the
defaults; this file lists the _changes_, one entry each, in the order they
landed.

## Decision

**2.0 shipped (2026-08-27):** every ledger row below has landed — the v2
profile is the default, the renamed/moved APIs (entries 1, 7, 9–10) were
removed, and `serverURL` now requires an explicit `mergeDepth`. `defaults: 'v1'`
remains through the 2.x line as the staged-migration escape hatch.

2026-09-14 (2.0.1): entry 1 was not removed. `isPreviewRequest` is exported from
the root entry and from `./astro` as a deprecated alias of `hasPreviewIntent`
until 3.0, as the ledger row says. 3.0 removed it with its module.

### 1. `defaults: 'v2'` is one switch

Every adapter and the runtime accept `defaults: 'v2'`. It sets every row of
the readiness table at once. Individual options remain for incremental
adoption and override the profile when given explicitly. A unit test asserts
that the profile assigns every row the table names, so a row added later
cannot be forgotten. `strict: true` is the subset of the profile that refuses
insecure configuration rather than merely defaulting away from it; `'v2'`
implies `strict`.

### 2. Deprecation, not removal, throughout 1.x

A renamed export stays available under the old name for the rest of 1.x. The
old name emits one development warning per process, never in production, that
names the replacement and this ledger. Deprecated names are removed in 2.0
and the codemod (`pll migrate`) rewrites them from the entries below.

### 3. Entry format

Each entry: the version it landed in, the kind (`rename`, `default`, `move`,
`remove`), the old and new forms, the profile row it belongs to, and the
codemod action. Entries are appended, never edited, so the ledger is a history.

## Ledger

| #   | Version                            | Kind    | Old                                                                                                                                                                                                                                                                          | New                                                                                                                                                                                                                                                                                                                       | Readiness row                                             | Codemod action                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.0                              | rename  | `isPreviewRequest(request, options)`                                                                                                                                                                                                                                         | `hasPreviewIntent(request, options)`; the 1.x name kept as a deprecated alias, removed in 3.0                                                                                                                                                                                                                             | `hasPreviewIntent()` replaces `isPreviewRequest()`        | rewrite import and call sites; identical signature                                                                                                                                                                                                                                                                                            |
| 2   | 1.1.0                              | default | response changes gated on intent only                                                                                                                                                                                                                                        | `authorizePreview` required (`strict`, `'v2'`); refused verdict blocks injection, CSP and nonce exposure                                                                                                                                                                                                                  | production response changes require an authorized context | none mechanical — flag the adapter call without `authorizePreview`                                                                                                                                                                                                                                                                            |
| 3   | 1.1.0                              | default | `previewSignals: ['query', 'fetch-dest', 'referer']`                                                                                                                                                                                                                         | `previewSignals: ['query']` under `'v2'`                                                                                                                                                                                                                                                                                  | query-only intent signal                                  | add `previewSignals` explicitly where the old set is relied on                                                                                                                                                                                                                                                                                |
| 4   | 1.1.0                              | default | `allowedOrigins` optional                                                                                                                                                                                                                                                    | required and non-empty under `strict`/`'v2'`; must be `https:` outside development                                                                                                                                                                                                                                        | explicit `allowedOrigins` required in production          | flag missing option                                                                                                                                                                                                                                                                                                                           |
| 5   | 1.1.0                              | default | runtime `disableReferrerDetection: false`                                                                                                                                                                                                                                    | `true` under `'v2'` (referrer trust off outside local dev)                                                                                                                                                                                                                                                                | referrer trust off outside local dev                      | add `disableReferrerDetection: true` where referrer trust is needed knowingly                                                                                                                                                                                                                                                                 |
| 6   | 1.1.0                              | default | messages accepted from any window that passes the origin check                                                                                                                                                                                                               | `eventSourcePolicy: 'parent-or-opener'` under `'v2'`                                                                                                                                                                                                                                                                      | messages must come from parent/opener                     | add `eventSourcePolicy: 'any'` where a different window legitimately posts                                                                                                                                                                                                                                                                    |
| 7   | 1.1.0                              | default | `createPreviewBindings({ authorized: boolean })`                                                                                                                                                                                                                             | `createPreviewBindings({ authorization: AuthorizedPreviewContext \| null })`; the boolean is refused under `strict`                                                                                                                                                                                                       | production response changes require an authorized context | rewrite `authorized: x` to `authorization: ctx` where `ctx` comes from `authorizePreviewRequest`                                                                                                                                                                                                                                              |
| 8   | 1.5.0                              | default | `skipUnchanged: false`                                                                                                                                                                                                                                                       | `true` under `'v2'`                                                                                                                                                                                                                                                                                                       | skip unchanged bindings by default                        | none; add `skipUnchanged: false` to keep re-rendering identical values                                                                                                                                                                                                                                                                        |
| 9   | 1.2.0                              | move    | `fetchPreviewDocument()` / `fetchPreviewGlobal()` on the root entry (draft by default, `null` on failure)                                                                                                                                                                    | `definePreview({ serverURL, depth }).fetchDocument()` / `.fetchGlobal()` on `payload-live-preview/server` (explicit `authorization`, typed failure, `signal`, timeout)                                                                                                                                                    | fetch helpers require explicit draft + authorization      | rewrite call sites onto `definePreview`; pass `authorization` where `draft` was computed                                                                                                                                                                                                                                                      |
| 10  | 1.2.0                              | default | `mergeDepth ?? 1` in the runtime and `depth ?? 1` in the fetch helpers, independently                                                                                                                                                                                        | `definePreview({ depth })` is required and feeds both; the 2.0 runtime default (`0` or explicit) is decided from measured consumer depths, not yet flipped by `'v2'`                                                                                                                                                      | merge depth `0` or explicit                               | add `depth` to `definePreview`; spread `runtimeOptions` into the adapter                                                                                                                                                                                                                                                                      |
| 11  | 1.3.0                              | default | sanitizer `'compat'`: `id` and every `data-*` pass                                                                                                                                                                                                                           | `sanitizerPolicy: 'strict'` under `'v2'`: `id`, `name` and `data-payload-*` stripped, other `data-*` by `allowedDataAttributes`; Trusted Types policy `payload-live-preview` at every sink                                                                                                                                | hardened sanitizer `id`/`data-*` policy                   | add `sanitizerPolicy: 'compat'` where rich text relies on `id` or `data-*`; list the CSP `trusted-types` name                                                                                                                                                                                                                                 |
| 12  | 1.4.0                              | range   | Astro peer `>=4.0.0 <8.0.0`, with 4, 5, 6 and 7 each run in CI (ADR 0009)                                                                                                                                                                                                    | unchanged under `'v2'`; 2.0 narrows the range to the majors the CI matrix still runs at release time                                                                                                                                                                                                                      | the tested majors only                                    | upgrade Astro to a major in the compatibility table before 2.0                                                                                                                                                                                                                                                                                |
| 13  | 2.0.0                              | rename  | `hasPreviewIntent(request, { adminOrigins })`                                                                                                                                                                                                                                | `{ allowedOrigins }` — the name the adapters, the client, the inline config and `pll doctor` use; `adminOrigins` stays a deprecated alias until 3.0 and loses when both are given                                                                                                                                         | —                                                         | `rename-admin-origins-option` rewrites the key; both keys at once is a conflict, not a rewrite                                                                                                                                                                                                                                                |
| 14  | 2.0.0                              | rename  | `CachedElement.boundary`                                                                                                                                                                                                                                                     | `CachedElement.hidesWhenEmpty` — the `data-payload-boundary` anchor that hides while its field is empty; the old name read like a fragment boundary                                                                                                                                                                       | —                                                         | none: a type-level rename that TypeScript reports; only a custom renderer that read the flag is affected                                                                                                                                                                                                                                      |
| 15  | 3.0 (planned, recorded 2026-09-19) | removal | `@internal` names the public entries still export at runtime — the root 28, `/core` 21, `/fragment` 19, `/structural` 15, `/codegen` 11, `/lexical` 5, `/migrate` 4, the adapters 2–3 each (API Extractor strips them from the `.d.ts` reports; the JavaScript exports them) | removed from the entries, or gathered behind one internal entry; a name a consumer reached for gets a public or `@beta` class in 2.1 first (2.1 plan, M9: a stability class per entry)                                                                                                                                    | —                                                         | none until 3.0; `etc/api/*.api.md` lists every `@internal` name, so a consumer can see what will go                                                                                                                                                                                                                                           |
| 16  | 3.0 (planned, recorded 2026-09-19) | removal | `setSanitizerDocument()`, the process-wide document slot; deprecated since 2.1                                                                                                                                                                                               | a call names its document: `sanitizeHtml(html, { document })`, `lexicalToHtml(content, { document })`, `<RichText document={…} />`                                                                                                                                                                                        | —                                                         | none until 3.0; `pll doctor` cannot see a server call, so the deprecation note on the declaration is the signal                                                                                                                                                                                                                               |
| 17  | 3.0 (planned, recorded 2026-09-29) | default | `subfieldCoverage: 'descendant'`: one bound path inside a group covers all of it                                                                                                                                                                                             | `'declared'`: each changed path inside a partly bound group needs a binding or a `data-payload-covers` declaration (ADR 0022); opt-in since 2.1                                                                                                                                                                           | groups covered path by path                               | none mechanical — with the option on, LP0203 names each uncovered path; add `data-payload-covers` where a page shows part of a group on purpose                                                                                                                                                                                               |
| 18  | 3.0 (planned, recorded 2026-09-29) | default | `lexicalToHtml()` without a sanitizer document warns once and returns its markup unsanitised                                                                                                                                                                                 | `requireDocument: true`: throws `SanitizerEnvironmentError`, as `sanitizeHtml()` does (ADR 0025); opt-in since 2.1                                                                                                                                                                                                        | server renders sanitised or refused                       | none mechanical — pass a `document` per call, or opt in and let the build name the renders without one                                                                                                                                                                                                                                        |
| 19  | 2.0.0                              | rename  | `onUnboundChange: 'route' \| 'ignore'`                                                                                                                                                                                                                                       | `onUnfaithfulPatch: 'escalate' \| 'ignore'`, which also covers patches that fail for other reasons; the old name stays a deprecated alias until 3.0, warns in development since 2.1 (ADR 0026) and loses when both are given                                                                                              | —                                                         | `rename-on-unbound-change` rewrites the key and value; both keys at once, or a value that is not a literal, is a conflict                                                                                                                                                                                                                     |
| 20  | 2.0.0                              | rename  | `signed-token` `replay: { isUsed, markUsed }`                                                                                                                                                                                                                                | `replay: { consume }`: one check-and-record step; the two-method store stays until 3.0 and warns in development since 2.1 (ADR 0026)                                                                                                                                                                                      | —                                                         | none: only the store can make the step atomic                                                                                                                                                                                                                                                                                                 |
| 21  | 3.0 (planned, recorded 2026-09-29) | removal | `defaults: 'v1'`, the 1.x profile                                                                                                                                                                                                                                            | the rows it stands for, written as options; warns in development since 2.1 (ADR 0026)                                                                                                                                                                                                                                     | —                                                         | `expand-defaults-v1` writes the rows into the options literal; a spread before the key, a shared object used by an adapter and a client, or a JSX attribute is a conflict; since 3.0 it leaves out `strict: false` (row 36) and writes the preview signals without `'referer'`, the two the profile stood for that an adapter no longer takes |
| 22  | 3.0 (planned, recorded 2026-09-29) | default | `new OriginDetector()` trusts `document.referrer` unless told not to                                                                                                                                                                                                         | `enableReferrerDetection: false`; the package's own callers already pass the option; warns in development since 2.4 where a detector built without the option trusts a referrer                                                                                                                                           | referrer trust off                                        | none: pass `enableReferrerDetection: true` where a hand-built detector relies on the referrer                                                                                                                                                                                                                                                 |
| 23  | 3.0 (planned, recorded 2026-09-29) | default | `RouteRefresh` may return `void`, taken as already committed                                                                                                                                                                                                                 | `() => Promise<void>` that settles after the host's commit; `LP0810` names a refresh that returns nothing since 2.1 (ADR 0028)                                                                                                                                                                                            | —                                                         | none mechanical: a host that renders synchronously returns `Promise.resolve()`; an asynchronous one awaits its commit                                                                                                                                                                                                                         |
| 24  | 3.0 (planned, recorded 2026-10-17) | removal | `authorizePreview` and `shouldInject` on `LivePreviewAstroOptions`; 2.1 refuses them at startup in every mode                                                                                                                                                                | omitted from the type, as `NuxtModuleOptions` already omits them; `authorizePreviewModule` and `createLivePreviewMiddleware()` take their place                                                                                                                                                                           | —                                                         | none: the options never ran in any mode, so no call has anything to rewrite                                                                                                                                                                                                                                                                   |
| 25  | 3.0 (planned, recorded 2026-10-26) | removal | Payload 2.x support (tested against 2.32.3), with what only Payload 2 needs: the schema-based field typing from `fieldSchemaJSON`, collection GETs for relationships, and the `documentInfo` callback arguments in the config plugin                                         | Payload 3.x and 4.x; every 2.x release of this package keeps supporting Payload 2                                                                                                                                                                                                                                         | —                                                         | none: upgrading the CMS to Payload 3 is the migration                                                                                                                                                                                                                                                                                         |
| 26  | 3.0 (planned, recorded 2026-11-01) | default | `useLivePreviewDocument()` and `createDocumentSession()` merge every update an allowed admin sends, whichever document it is for; `document` is optional                                                                                                                     | `document` is required, so a hook merges only the document it names; one that follows every document has to say so; warns in development since 2.4                                                                                                                                                                        | —                                                         | none mechanical: name the document the page rendered, `document: { collection, id }` or `{ global }`; the option exists since 2.3                                                                                                                                                                                                             |
| 27  | 3.0 (planned, recorded 2026-11-01) | default | a merge request has no deadline; `mergeTimeoutMs` and a hook's `timeoutMs` are off                                                                                                                                                                                           | both have a default deadline of 10 000 ms, from the 2026-11-03 measurement (ADR 0026); a stalled merge is reported, and an explicit value still wins, `0` for none; warns in development since 2.4                                                                                                                        | —                                                         | none mechanical: set the values now to see the effect; a server that answers slowly needs a higher one                                                                                                                                                                                                                                        |
| 28  | 3.0 (planned, recorded 2026-11-01) | range   | `engines.node` `>=20.19.0`; Node 20 reached end of life on 2026-04-30                                                                                                                                                                                                        | Node 24 or newer, `>=24.0.0`                                                                                                                                                                                                                                                                                              | —                                                         | none: move the build and the server to Node 24 or newer, which 2.x already runs on                                                                                                                                                                                                                                                            |
| 29  | 3.0 (planned, recorded 2026-11-01) | range   | the oldest framework versions are stated in the README and, for Astro, in the peer range                                                                                                                                                                                     | Next.js 15.5 is unchanged. SvelteKit, Astro and Nuxt changed through rows of their own, 34, 35 and 45. A major leaves only through a row here                                                                                                                                                                             | —                                                         | none                                                                                                                                                                                                                                                                                                                                          |
| 30  | 3.0 (planned, recorded 2026-11-01) | range   | `payload` peer `^2.0.0 \|\| ^3.0.0 \|\| ^4.0.0-0`                                                                                                                                                                                                                            | `^3.0.0 \|\| ^4.0.0`, with `^4.0.0-0` while Payload 4 is in pre-release; Payload 5 arrives in a 3.x minor of this package, not in a 4.0                                                                                                                                                                                   | —                                                         | none beyond row 25: a site on Payload 3 or 4 changes nothing                                                                                                                                                                                                                                                                                  |
| 31  | 3.0 (planned, recorded 2026-11-03) | default | with a `locale` in `document`, `useLivePreviewDocument()` and `createDocumentSession()` still merge an update that names no locale; only one for another locale is left alone                                                                                                | an update that names no locale is left alone too, so a hook with a `locale` merges only the updates for that locale; `requireLocale: true` does it since 2.4, and a hook that merges such an update warns in development                                                                                                  | —                                                         | none mechanical: Payload 3 and 4 name the admin's locale in every update when the config has localization; where updates name none, leave `locale` out                                                                                                                                                                                        |
| 32  | 3.0 (planned, recorded 2026-11-03) | removal | `livePreviewScriptProps()` without `delivery: 'asset'`: a synchronous helper that puts the whole runtime into every page that renders it, and into React's flight payload a second time                                                                                      | `await LivePreviewScript({ request, ...options })`, which renders nothing for a request it does not authorize, or `delivery: 'asset'`; `renderLivePreviewScript()` stays for HTML a server builds as a string; warns in development since 2.4                                                                             | —                                                         |
| 33  | 3.0 (planned, recorded 2026-11-03) | default | the Astro integration delivers inline when `mode` is not set: the whole runtime in every page                                                                                                                                                                                | `mode: 'loader'`, a bootstrap that fetches the runtime only in a preview context; `mode: 'inline'` keeps the old delivery; warns in development since 2.4                                                                                                                                                                 | —                                                         |
| 34  | 2.5.0                              | range   | SvelteKit 2 and 3, each installed by a CI job                                                                                                                                                                                                                                | SvelteKit 3. SvelteKit 2 is no longer tested: its release line has a high-severity advisory that is patched only in 3.1.1 (GHSA-3r8g-jcqq-3p5j). The adapter's code is unchanged, so a SvelteKit 2 project keeps the code it has, without a job that proves it. This replaces the SvelteKit part of row 29                | —                                                         | none: `npx sv migrate sveltekit-3` moves a project, and `docs/sveltekit.md` says what changes in the snippets                                                                                                                                                                                                                                 |
| 35  | 3.0                                | range   | `peerDependencies.astro` `>=4.0.0 <8.0.0`; Astro 4, 5 and 6 each installed by a CI job                                                                                                                                                                                       | `>=7.2.8 <8.0.0`. Astro releases only its current major, and Astro 4 to 6 carry a critical advisory that is patched only in 7.2.8 (GHSA-26w7-cxv4-gfx2), which is why the range begins there and not at 7.0.0. The base adapter runs at 7.2.8 on every push. This replaces the Astro part of row 29                       | —                                                         | none: update Astro to 7.2.8 or newer with Astro's own upgrade guides; a project that stays on Astro 4 to 6 stays on 2.x                                                                                                                                                                                                                       |
| 36  | 3.0 (decided 2026-11-25)           | removal | `strict: false`: an adapter that changes a response on preview intent alone, without `authorizePreview`                                                                                                                                                                      | omitted from the type, which keeps `strict?: true`; an adapter that decides per request needs `authorizePreview`, non-empty `allowedOrigins` (`https:` in production) and no `'referer'` signal, and one given `strict: false` refuses to start                                                                           | —                                                         | none: only the site can say who may see a preview; `pll doctor --v3` names the places and docs/authorization.md has the strategies                                                                                                                                                                                                            |
| 37  | 3.0 (decided 2026-11-24)           | removal | the lean runtime: `LEAN_RUNTIME` from the `/lean` entry and the `runtime` option, a second artifact of about 36 KiB gzip against 44 that leaves out the strategies, the keyed morph, structural arrays, item templates, the announcer and auto-binding                       | one runtime. The entry, the option, `RuntimeArtifact` and the diagnostic for a feature it left out are gone. Fewer bytes for a visitor come from delivering the runtime as an asset, where a page carries a bootstrap of a few hundred bytes: `delivery: 'asset'`, and Astro's `mode: 'loader'`, the default since row 33 | `pll doctor --v3` names a `runtime` option                | none: delete the import and the option; the build fails on the import until then                                                                                                                                                                                                                                                              |
| 38  | 3.0 (decided 2026-11-24)           | rename  | `disableVisibilityGate`, `disableReferrerDetection` and `disableLocalhostMatching`: three switches named by what they turn off                                                                                                                                               | `enableVisibilityGate` (default `true`), `enableReferrerDetection` (default `false`) and `enableLocalhostMatching` (default `true`), each with the value turned round, as the hooks and `OriginDetector` already spell the origin switches. An adapter, the generator or the client given an old name refuses to start    | —                                                         | `rename-disable-switches` rewrites a literal `true` or `false`; any other value, a JSX attribute, or both names at once is a conflict                                                                                                                                                                                                         |
| 39  | 3.0 (decided 2026-11-27)           | default | a hook session (`useLivePreviewDocument()`, `createDocumentSession()`) takes an update from every allowed origin for as long as it listens                                                                                                                                   | it listens to the origin whose update it accepted first, as the inline runtime and `LivePreviewClient` do; another allowed origin is refused until the last subscriber leaves                                                                                                                                             | —                                                         | none: nothing to set; a page that two admins drive in turn is opened from the one that edits                                                                                                                                                                                                                                                  |
| 40  | 3.0 (decided 2026-11-27)           | default | no route strategy in an adapter unless `routeStrategy` or `fragments` asks for one, so `onUnfaithfulPatch: 'escalate'`, the default, has nowhere to go                                                                                                                       | `routeStrategy: 'router'` in the Next.js, SvelteKit and Nuxt adapters: after a save, the route is refreshed through the router refresh the page lent, and never fetched and morphed. Astro, the generator and the bootstrap of `livePreviewScriptProps()` keep none                                                       | `pll doctor --v3` names a page without either option      | none: render `LivePreviewNavigation` (Next.js) or call `livePreviewNavigation()` (SvelteKit), which the guides describe since 2.4; the Nuxt module lends the refresh itself. `routeStrategy: false` keeps none                                                                                                                                |
| 41  | 3.0 (decided 2026-11-27)           | move    | the entry `/payload`, which exports `buildLivePreviewUrl()` and its types, beside `/plugin` and `/plugins`: three names for three things                                                                                                                                     | the entry `/plugin` exports `buildLivePreviewUrl()` and its types under the same names; `/payload` is gone from the exports map                                                                                                                                                                                           | —                                                         | `move-payload-entry` rewrites the specifier wherever a script names the entry as a module: `import`, `export … from`, `import()`, `require()`, an `import()` type                                                                                                                                                                             |
| 42  | 3.0 (decided 2026-11-27)           | removal | the entries `/doctor` and `/migrate`: the checks and the codemods of the `pll` binary as libraries (`runDoctor()`, `analyzeProbe()`, `migrateSource()`)                                                                                                                      | the `pll` binary alone: `pll doctor <url> --json` prints the findings for a script, `pll migrate <path>` runs the codemods. Neither subpath is in the exports map, so an import of one does not resolve                                                                                                                   | `pll doctor --v3` names a call from either entry          | none: run the binary                                                                                                                                                                                                                                                                                                                          |
| 43  | 3.0 (decided 2026-11-24)           | removal | ten entries built twice, as ESM and as CommonJS, and every entry a bundle of its own with its own copy of every class and registry it shares with the others                                                                                                                 | one module graph, ESM alone: a shared module is built once as a chunk the entries import. The entries that had a CommonJS build answer `require()` with the ES module `import` gets, which Node 24 loads. No `.cjs` file and no `require` condition are left                                                              | —                                                         | none: an `import` or a `require()` of an entry by its name keeps working. A deep import of a file under `dist/` does not: the shared files change their names with every release                                                                                                                                                              |
| 44  | 3.0 (decided 2026-11-24)           | removal | `AUTHORIZED_PREVIEW_BRAND_KEY` on the root, `/core` and `/server`, and a context marked by a registry symbol, which a frozen copy keeps and a hand-built object can carry                                                                                                    | a context is the object `authorizePreviewRequest()` made: the module keeps a list of them, and a copy, frozen or not, and an object built by hand are refused. The context has no key of that name, and nothing exports one                                                                                               | —                                                         | none: pass the context itself, as `docs/authorization.md` has always said; delete an import of the name                                                                                                                                                                                                                                       |
| 45  | 3.0 (decided 2026-11-24)           | range   | Nuxt 4, and Nuxt 3 as kept working after its end of life on 2026-07-31: a Nuxt 3 example and a Nuxt 4 twin of it, each run by CI jobs                                                                                                                                        | Nuxt 4. Nuxt 3 is no longer tested: its example left, and the one Nuxt example runs Nuxt 4 in the `app/` layout. The module's code is unchanged, so a Nuxt 3 project keeps the code it has, without a job that proves it. This replaces the Nuxt part of row 29                                                           | —                                                         | none: Nuxt's own upgrade guide moves a project to 4, and the snippets of `docs/nuxt.md` are written for the `app/` layout                                                                                                                                                                                                                     |
| 46  | 3.0 (decided 2026-11-27)           | move    | the entries `/core`, `/plugins` and `/structural` beside `/client`: four entries for what runs in a browser, each with part of it, and the root with another part                                                                                                            | `/client` exports everything that runs in a browser: the client, the document session, the plugin manager and plugins, the protocol and origin helpers, the sanitizer, the keyed morph. The root exports every name of `/client`, the script generator and the server helpers. The three entries are gone                 | —                                                         | `move-core-entry`, `move-plugins-entry` and `move-structural-entry` rewrite the specifier to `/client`; `/core`'s binding, CSP and authorization names go to the root, and an import that mixes both kinds is reported and left                                                                                                               |
| 47  | 3.0 (decided 2026-11-27)           | default | on a page a framework hydrates, `routeStrategy: true`, `'after-save'` and the route a fragment endpoint brings fetch the route and morph it in where the page lent no route refresh                                                                                          | every route strategy on such a page (`hydration: 'react'`, `'vue'`, `'sveltekit'`) refreshes through the lent refresh alone, as `'router'` does; a page that lent none is left as it is and LP0808 names what to render. `true` and `'after-save'` still decide when. Astro, plain HTML and `'manual'` keep the morph     | `pll doctor --v3` names the call                          | none: render `LivePreviewNavigation` (Next.js) or call `livePreviewNavigation()` (SvelteKit); the Nuxt module lends its refresh itself. A value only the project has decides whether it wants the component                                                                                                                                   |
| 48  | 3.0 (decided 2026-11-28)           | range   | `payload` peer `^3.0.0 \|\| ^4.0.0-0` (row 30)                                                                                                                                                                                                                               | `>=3.90.0 <4.0.0 \|\| ^4.0.0-0`. Every Payload 3 release before 3.90.0 carries critical advisories that are patched only there (GHSA-66wr-7vmr-p5jq, GHSA-f7hx-52q9-hcrf), which is why the range begins there, as row 35 does for Astro. The package gate checks the plugin's types against 3.90.0                       | —                                                         | none: update Payload inside its major to 3.90.0 or newer; a project that stays on an older Payload 3 stays on 2.x                                                                                                                                                                                                                             |
| 49  | 3.0 (decided 2026-11-28)           | default | the `payload-session` strategy asks `/me` with the cookie alone, adds the origin of `serverURL` in one retry when `/me` reports no user, and remembers per endpoint that the origin was needed                                                                               | the cookie goes with an `Origin` from the first request: `origin` where the strategy names one, the origin of `serverURL` otherwise. One request per check and nothing remembered. Only Payload 3.79.0 and older take the cookie alone with a CSRF list, and row 48 ends their support                                    | —                                                         | none: set `origin` to an origin Payload's `csrf` list holds where that list does not hold the origin of `serverURL`                                                                                                                                                                                                                           |

2026-09-16 (2.0.1): row 5's "outside local dev" names an exception the runtime
does not have. `disableReferrerDetection` is `true` everywhere under `'v2'`;
the localhost matcher is a separate option (`disableLocalhostMatching`), and
the readiness label and docs/migration.md say "referrer trust off".

2026-09-22 (2.1): `isMorphBoundary` moves from `@internal` to `@beta` with
`MorphOptions.boundary`, so coordinators can extend the package rule without
copying it. Row 15's dated `/structural` count is now 14; the recorded count
stays in the ledger as the baseline it was on 2026-09-19.

2026-11-25 (3.0): row 29 said that 3.0 drops no framework major. That was
decided again on 2026-11-24, for the reason row 34 gives for SvelteKit 2: a
line that no longer gets patches cannot be claimed as supported. Row 35 is the
Astro part.

2026-11-25 (3.0): row 28 named Node 22 when it was recorded. The floor is
Node 24: Node 22 reaches its end of life on 2027-04-30, within the first year
of 3.x, and Payload 4.0.0-beta.12 asks for `^24.22.3 || >=26.13.1` itself.
`engines.node` is `>=24.0.0`. The unit and integration suites pass on the
official 24.0.0 binary (run by hand on 2026-11-25) and run in CI on the newest
Node 24 and 26; every other CI job runs Node 24.22.3. A project on Node 20 or
22 stays on 2.x.

2026-11-28 (3.0): row 49 is new and carried out. The request with the cookie
alone was kept for Payload 2 and named for it. Read off the released
`dist/auth/extractJWT.js`, Payload 3.0.0 to 3.79.0 take such a cookie whatever
the CSRF list holds, and 3.79.1 and newer take it from a server only without
a list
([ADR 0006](0006-authorized-preview-context.md), addenda of 2026-11-28). With
row 48 the first group is not supported, so for every supported Payload the
first request was either accepted with an origin as well, or refused and
repeated with one. The strategy now sends the origin at once. What went with
the retry is gone too: the per-endpoint memory that the origin was needed, the
request with the cookie alone once a minute, and 42 of the module's 247 lines.
A site whose CMS lists only the frontend's origin sets `origin`, as it had to
on Payload 3.79.1 and newer before.

2026-11-28 (3.0): row 48 is new and carried out. Row 30 took the `payload`
peer to `^3.0.0 || ^4.0.0-0` when Payload 2 left. Read against GitHub's
advisory database on 2026-11-28, Payload 3.0.0 is named by 26 advisories, four
of them critical, and 3.89.0 still by sixteen, three of them critical
(GHSA-66wr-7vmr-p5jq, GHSA-f7hx-52q9-hcrf, GHSA-vc4h-q48j-5hcx), every one
patched in 3.90.0; 3.90.0, 3.94.2 and 4.0.0-beta.12 are named by none. Rows 34
and 35 set the SvelteKit and Astro floors by that rule: a release
with a known critical advisory that a later release of the same major patches
is not claimed as supported. The pre-release range of Payload 4 stays as it is:
Payload 4 is followed, not yet supported. What ran below the new floor stays as
a record and is no claim: the captured messages of 3.85.0, 3.88.0 and 3.89.0
are still replayed. The lane installs 3.90.2 and the real admin 3.94.2.

2026-11-27 (3.0): row 47 is new and carried out. Row 40 made the router the
default owner of the route on a page a framework hydrates and left the
explicit values as 2.x had them: where the page lent no route refresh,
`routeStrategy: true`, `'after-save'` and the route a fragment endpoint brings
fetched the route and morphed it in. Measured for row 40 on Next.js 16 against
the real admin, that morph took `<next-route-announcer>` and one of the
router's scripts out of the body. It takes out every child of `<body>` the
fetched HTML does not have, and it writes into DOM the framework's reconciler
owns. The runtime now reads the hydration owner: with `hydration: 'react'`,
`'vue'` or `'sveltekit'` the route is refreshed through the lent refresh
alone, whichever option asked for a route, and `true` and `'after-save'` only
decide when. `hydration: 'manual'` names no framework and keeps the morph, as
a page without a hydration owner does.

2026-11-27 (3.0): row 46 is new and carried out, the second cut of the entry
table. The first plan was to merge `/core`, `/client` and `/plugins` into the
root. Measured first: a bundler gives the same bytes for a name whichever
entry it comes from. The tree-shaking rows show it for Vite 7 and 8, and a
Next.js 16 app that imports `initLivePreview` builds byte for byte the same
client JavaScript from the root, from `/client` and from the core entry, with
Turbopack and with webpack. A page that loads an entry without a bundler loads
it whole, though, and the root holds the script generator with the runtime as
text. So one browser entry stays, and it is a rule and not a list: `/client`
is what runs in a browser, and the root is `/client` (`export *`) and what a
server needs. `tests/unit/bundle-shape.test.ts` holds the thirteen names the
root adds. Loaded whole, `/client` is 43 files with 203 745 bytes and the root
50 files with 379 870.

The root gains the six names only the focused entries had
(`createDocumentSession`, `PluginManager`, `createUnboundFieldsOverlayPlugin`,
`morphElement`, `isMorphBoundary`, `retainIslandBoundary`). `/structural` held
three functions after row 15, and no guide or example loaded it on its own.
Four of its types described functions row 15 removed and are gone:
`ArrayPatch`, `DependencyMap`, `StructuralApplyOptions` and `StructuralStore`.
`/core` also exported the binding helpers, two CSP helpers and the
authorization guard, which a server calls: they are on the root and on
`/server`, and its codemod sends an import by the names it takes. Every
function and class `/client` exports keeps its name in the build, as the core
entry's did.

Merging entries made the chunks coarser, since the build drew them by the
set of entries that reach a module, and a Next.js app, whose bundlers take a
file whole, paid 6.8 kB gzip more for `initLivePreview`. The build now draws
a boundary around every module that defines a public name, and the same app
ships what it shipped before ([ADR 0012](0012-package-topology-and-delivery-profiles.md)
has the measurement). With Vite 8, `initLivePreview` from `/client` costs
53 239 bytes gzip where it cost 52 949 from the core entry, `morphElement`
1 506 (1 495) and `PluginManager` 3 243 (3 277).

2026-11-27 (3.0): row 45 is new and carried out. The Nuxt 3 example is gone,
and the Nuxt 4 example has its place and its name, `examples/nuxt-payload`,
with the production host beside it. The job that ran the Nuxt 4 twin and the
twin's three real-admin targets went with it: the E2E job, the production
lifecycle and the real-admin targets run the one example. Nuxt 3 was kept
working past its end of life by an example of its own; no job proves that any
more, so the guide no longer says it. It was the last fixture that installed
Vite 7.

2026-11-27 (3.0): row 27 is carried out. A merge has a deadline of 10 000 ms:
`mergeTimeoutMs` for the runtime and the client, `timeoutMs` on a hook, one row
of the defaults table. It is applied where the runtime and the hook build their
merger; the merger itself, in the trusted core, still has none unless it is
given one. `0` keeps the wait of 2.x. The two notices that announced the
default are gone, and with them the browser's notice registry, which had no
other user. `pll doctor --v3` still lists the calls that set no deadline.

2026-11-27 (3.0): the defaults are written once. `src/runtime/types/defaults-profile.ts`
held the six readiness rows; every other default stood as a literal where it was
applied, and some stood twice or three times: the visibility threshold in the
scheduler and in `pll doctor`, the intent parameters in the request predicate,
the Next.js config helper and the doctor's probe, and the runtime's rows in the
inline start, in the client and in the runtime class, whose own fallbacks were
still the 1.x ones for three rows. The table now holds every row that code
applies, whoever applies one reads it there, the inline start and the client
fill in nothing of their own, and a gate holds the Default column of
docs/options.md to the same rows. No default changes. The merger's fallbacks
for `apiRoute` and the depth stay where they are, in the trusted core.

2026-11-27 (3.0): row 38 is added and carried out. An option that names
what it turns off reads twice negated wherever it is off by default:
`disableReferrerDetection: false` turned referrer trust on. The three switches
are named by what they turn on, as `enableA11y`, the hooks and `OriginDetector`
already were. Only a literal is rewritten by `pll migrate`: any other value may
be `undefined`, which meant the default under the old name and would read as
"on" once negated. The inline tuple is not reordered, though a major could:
`pll doctor` of one version reads the page another version served by slot
number, and a new order would need a generation marker and a second key table
to save four commas. The three old slots stay empty, as the slot of
`onUnboundChange` does, and the new ones are appended; the doctor reads either
and words a finding in the spelling of the version that wrote the page.

2026-11-27 (3.0): row 37 is added and carried out: the lean runtime leaves.
It saved a visitor about a fifth of the script, and since row 33 a visitor of
an Astro site downloads a bootstrap, not the script; the adapters deliver the
same way with `delivery: 'asset'`. What it cost was a second artifact with a
second behaviour: a build flag read at six places, a runner of its own, a
diagnostic for what it left out, and the one generated file that had to be
committed, with the gate that kept it current. All of that goes with it. The
branch that parked the Nuxt 3 example takes the next free row.

2026-11-27 (3.0): row 23 is carried out. `RouteRefresh` is `() =>
Promise<void>`. A function a JavaScript caller registers that returns no
promise is still called, but its refresh counts as failed, not as committed:
the revision is written onto the markup that stands, the display names the
route as a shortfall, and `LP0810` says so once under `debug`. The three
adapters' navigation entries returned the promise already.

2026-11-27 (3.0): row 17 is carried out. A page that sets no
`subfieldCoverage` runs on `'declared'`: each changed path inside a partly
bound group needs a binding or a `data-payload-covers` declaration, and
`'descendant'` is the 2.x rule under its name. The development notice that
announced the change leaves the registry with its code. Measured before the flip: the nine example
fixtures and seven real-admin targets on Payload 3.94.2 behave as before,
except the page that held the old default. What a site meets first is the
`id` of an array row or of a related document, a changed path like the others
when a row moves or a relationship switches.

2026-11-27 (3.0): rows 22 and 33 are carried out. `new OriginDetector()`
trusts the origin of `document.referrer` only where `enableReferrerDetection:
true` asks for it; the runtime, the client and the hooks passed the option
already, so only a detector a project builds itself changes. The Astro
integration without `mode` delivers through `'loader'`: a bootstrap in the
page and the runtime as a hashed asset, fetched only in a preview context;
`mode: 'inline'` is the 2.x delivery under its name. Both notices of 2.4 are
gone with the defaults they announced.

2026-11-27 (3.0): row 18 is carried out. `lexicalToHtml()` and the Astro
`RichText` component throw `SanitizerEnvironmentError` where they have no
document to sanitise with, as `sanitizeHtml()` always did. `requireDocument:
false` is the 2.x behaviour under its name, the markup as rendered with one
warning, and `sanitize: false` still says that the caller sanitises itself. A
browser has a document, so nothing changes there.

2026-11-27 (3.0): rows 43 and 44 are new and carried out: one module graph
(the plan's A-1, fixed on 2026-11-24).

- Until 3.0 each of the package's entries was bundled alone, ten of them as
  ESM and as CommonJS. Every class and every registry existed once per entry,
  which is why a Lexical block registered through one entry was not seen by
  another and why the authorization mark had to be a registry symbol. Measured
  on the build before: 2 751 547 bytes of JavaScript in the archive, 1 956 570
  of them ESM. As one graph it is 541 124 bytes in 66 files.
- What an entry costs is its closure now, its own file with the chunks it
  loads. Loaded unbundled, that is more than the single file was, because a
  chunk carries what any of its entries needs: 3 to 5 % for the adapters, 6 %
  for the root, 14 % for `/core`, 21 and 23 % for the hooks, 72 % for
  `/plugins` and 120 % for `/fragment`. What a bundler keeps for one imported
  name is level with before: the tree-shaking rows moved by a few bytes, and
  `initLivePreview` from the root lost 286 bytes gzip.
- `require()` still works for the entries that had a CommonJS build, and for
  `/nextjs`: Node 24.0.0 and 24.22.3 load them from a CommonJS file, and a
  CommonJS-loaded `next.config.ts` relies on it. The other entries were
  import-only before and are.
- Row 44 follows from the one copy. The mark of an authorized context was a
  registry symbol so that two copies of the module agreed on it, and a
  registry symbol is one anybody can write: a frozen object carrying it
  passed. The module keeps the contexts it made instead. Two copies of the
  package in one process no longer accept each other's contexts.

2026-11-27 (3.0): row 15 is carried out. The API reports listed 82 names
marked `@internal` that an entry exported at run time: the root 20, `/core`
16, `/fragment` 13, `/structural` 10, `/codegen` 7, `/lexical` 5, the Nuxt
module 3, the Astro adapter 3, `/annotate` 2, and one each in `/plugins`, the
Next.js and the Nuxt adapter.

- Three names are public now, because something outside the package's own
  modules imports them: `VERSION` and `generateCspNonce()` (the reference
  site) and `isLexicalContent()` (the package's `RichText.astro`, which a
  project's Astro compiles, and an example). Each stood in two reports, six of
  the 82.
- The other 76 left the entries. The package's modules and tests import them
  from the module that defines them; with one module graph no entry has to
  export a name for another entry to reach it.
- Nothing gathers them behind an internal entry, the alternative this row
  named: no reader was found for one.
- The 36 names left under `@internal` are types that public signatures
  reach. `scripts/check-complexity.ts` counts a function, a constant or a
  class under that tag in a report, and the reviewed number is 0.
- An entry no longer loads what only those exports needed: `/structural` is
  5 776 bytes with its chunks where it was 26 539, `/codegen` 12 312 where it
  was 18 209.

2026-11-27 (3.0): rows 41 and 42 are new and carried out, the first cut of
the entry table. Three sites and the examples import 7 of the package's
entries; each one kept is a surface to hold stable. `/payload` held one
function and its types beside `/plugin` and `/plugins`, and merges into
`/plugin`, the entry a `payload.config.ts` imports anyway. `/doctor` and
`/migrate` were the `pll` binary's own modules as libraries; no site, example
or guide imported them, and the binary's `--json` is the interface a script
reads. `/codegen`, `/codegen/astro` and `/annotate` stay for now:
`livePreviewAnnotate()` and `livePreviewCodegen()` are build plugins a config
imports, which no binary replaces.

2026-11-27 (3.0): row 40 is new and carried out. `onUnfaithfulPatch:
'escalate'` has been the default since 2.0 and did nothing on a page with no
strategy. The Next.js, SvelteKit and Nuxt adapters now carry the route
strategy for a script an authorized request receives, as a new value,
`'router'`: the route is refreshed after Payload reports the save, through the
route refresh the page lent, and through nothing else.

- The value exists because of a measurement. Against the real admin (Payload
  3.94.2, Chromium), the Next.js 16 and SvelteKit 3 example pages, which lend
  no refresh, took an unbound change by fetching the route and morphing it in,
  without an error. On the Next.js page the morph removed
  `<next-route-announcer>`, the router's own element, from the body. A default
  must not do that to a page that asked for nothing, so a page that lent no
  refresh is left as it is and `LP0808` names what to render. `true` and
  `'after-save'` keep the morph where nothing was lent, as 2.x documents it.
- It applies where neither `routeStrategy` nor `fragments` is set. A fragment
  endpoint carries the route strategy already and keeps its 2.x timing.
- `livePreviewScriptProps()` builds a bootstrap every visitor receives, so the
  default stops there: the prelude would have taken it from about 1.3 kB to
  about 10. Astro pages are not hydrated as a whole and keep no default.
- The cost is the route prelude on a preview page an editor loads, about 8.6
  kB raw and 2.6 kB gzip.
- Reading field types from the Payload config at build time, asked in the same
  question, is left for a 3.x minor.

2026-11-27 (3.0): row 39 is new and carried out. A hook session locks onto
the origin of the first update it accepts for its document and releases the
lock when its last subscriber leaves. The inline runtime has done so since
1.x; a hook kept the whole allow-list, so with two admins on it the second
could write into a preview the first had opened. An update the session leaves
alone, one for another document or locale, decides nothing. There is no
option: with one allowed origin nothing changes, and a byte limit on the merge
answer, asked in the same question, waits for a measurement on real documents.

2026-11-27 (3.0): rows 26 and 31 are carried out. `document` is required on
`useLivePreviewDocument()` and `createDocumentSession()`, and a hook with a
`locale` leaves alone an update that names none.

- A session without `document` does not start. The type requires it; a
  JavaScript caller that leaves it out gets the reason and the two ways on when
  the session is created, in production too. A session that merged whatever
  arrived would do other than its page was written for, and it would do so
  silently.
- `document: 'any'` is the way to say that a hook follows every document: what
  row 26 called "has to say so". It is the 2.x default under a name, for a page
  that renders whatever the admin edits; a create screen is one, because its
  document has no id to name yet.
- `requireLocale`, the opt-in of 2.4 for row 31, is what a hook does now. `true`
  is still taken; `false` is refused when the session is created, with the way
  out: leave `locale` out of `document` where the admin sends updates without
  one.
- The two development notices that announced these rows are gone; the one for
  a hook without a merge deadline (row 27) stays until that row is done.

2026-11-27 (3.0): rows 21 and 36 are carried out, together, because the
profile was the other spelling of the second: `defaults: 'v1'` stood for
`strict: false` and five more rows. An adapter that decides per request has no
mode without `authorizePreview` any more, in development or in production; the
warning about a preview gated on intent alone went with the branch it warned
about. Row 36 was decided on 2026-11-25. The alternative, `strict: false` kept
outside production with a notice at startup, was not taken: a second mode that
exists only in development is still a mode every example and every test of an
adapter can run in, and three of this repository's own examples did.

- `defaults: 'v1'` and `strict: false` are refused at startup with the reason
  and the way out, by the adapters and the Astro integration in every mode;
  the profile also by the generator and by the client, which would otherwise
  fill other rows than the ones it was asked for. `defaults: 'v2'` and
  `strict: true` are still taken.
- `expand-defaults-v1` writes the four runtime rows and the preview signals
  without `'referer'`. It does not write `strict: false`: a site that ran on
  the profile needs a hook, and no codemod can say who may see its preview.
- The doctor still reads a page that 2.x served under the profile and names
  its rows; the 1.x table it compares with lives in the doctor now.
- With the profile goes the exemption it gave from row 10: `serverURL` needs
  an explicit `mergeDepth` everywhere.
- The examples that ran on the profile authorize now. Both Nuxt examples
  verify a signed token, the route-bound one of the framed URL or the session
  cookie their mock admin asks for, and `astro-hybrid` verifies the token its
  own middleware puts into the framed URL, on every route.

2026-11-26 (3.0): rows 1, 13, 16, 19, 20, 24 and 32 are carried out. The names
are gone from the code and from the types: `isPreviewRequest()` and its module,
`adminOrigins`, `setSanitizerDocument()` and its slot on the realm,
`onUnboundChange`, the replay store with `isUsed` and `markUsed`,
`authorizePreview` and `shouldInject` on `LivePreviewAstroOptions`, and inline
delivery through `livePreviewScriptProps()`.

A type does not reach a JavaScript config, so each row also says what happens
to a value that still arrives. The rule: where leaving it out of account would
run the site with other behaviour than it asked for, the server side refuses
it at startup, in production too, and names the codemod or the replacement.

- `onUnboundChange` (19): the adapters and the generator throw. Its slot 20 in
  the inline tuple keeps its number and stays empty, and the runtime reads
  nothing from it; the direct runtime option is no longer read either.
- A replay store without `consume` (20): a `PreviewConfigurationError` at the
  first request, before a token is read. Without the check such a store would
  refuse every token as `unavailable` and never say why.
- `livePreviewScriptProps()` without `delivery: 'asset'` (32): the call throws.
- `authorizePreview` and `shouldInject` on the Astro integration (24): refused
  at startup as since 2.1. `createLivePreviewMiddleware()` takes
  `PreviewAdapterOptions`, which has both, because it runs per request.
- `adminOrigins` (13) is not refused: the key is no longer read, which leaves
  the referer signal without an origin and so counts fewer requests as intent,
  never more.
- `isPreviewRequest()` (1) and `setSanitizerDocument()` (16) fail the import.
  The realm slot of row 16 is no longer read, so a 2.x copy of the package in
  the same process cannot hand its document to a 3.0 call.

2026-11-25 (3.0): rows 25 and 30 are carried out. An admin that sends
`fieldSchemaJSON` is a Payload 2 admin, and its updates are refused: from the
first such message on, the runtime applies nothing of that peer and reports
`LP0504` once, in every build, and a hook reports `unavailable` with the same
reason. The page stays as the server rendered it. Applying what could be
applied was the alternative and was not taken: the scalar values would have
arrived and every relationship stayed an id, without a word in production. With
the schema go the things that stood on it: `RenderContext.schema`, the types
`PayloadFieldSchema`, `PayloadBlockSchema` and `PayloadFieldCondition`, the
option labels of the `select` renderer, and `fieldTyping` and
`populatesRelationships` on `ProtocolProfile`, the two labels the addendum of
2026-10-03 kept for 2.x. A sender of its own that added a schema for its field
types leaves the field out and sets `data-payload-type` on the bindings. `buildLivePreviewUrl()`
and the config plugin read `collectionConfig` and `globalConfig`, not
`documentInfo`. The `payload` peer range is `^3.0.0 || ^4.0.0-0`.

## Addendum — what `pll migrate` automates

Four ledger entries have codemods: 1 (`rename-is-preview-request`), 7
(`rename-bindings-authorized-option`), 9 (`move-fetch-preview-helpers`) and 13
(`rename-admin-origins-option`).
The rest are "flag it", not "rewrite it": their new form needs a value only the
consumer has (an authorization verdict, a considered `depth`), so the tool would
have to invent one.

The codemods plan their rewrites on the AST (ts-morph) and touch only names a
file binds from `payload-live-preview`, by `import`, `require()` or `import()`.
A consumer's own `isPreviewRequest` is therefore left alone. Where a rewrite
would be visible outside the file — an object shorthand, a re-export, a call
whose options are not a literal — the codemod reports `file:line` and changes
nothing in that file, and the CLI exits `3`.

2026-09-29 (2.1, ADR 0026): two more, 19 (`rename-on-unbound-change`) and 21
(`expand-defaults-v1`). Both also rewrite a `const` options object that a call
in the same file takes by name or spreads; an exported one changes for every
importer, with the values it already had. Since 2.1 the forms 3.0 removes warn
once per process in development, as §2 promised for 1.x.

## Addendum — app two: Next.js and React, 1.8.1 → 2.0 (2026-09-11)

The 2.0 gate is "migration verified in two materially different apps". App one
is Sala (Astro 7, SSR): `pll migrate` rewrote its one affected file, and its 667
tests and `astro check` pass on the 2.0 build. There is no second 1.x consumer,
so app two is this repository's Next.js fixture as it stood at `v1.8.1` — a 1.x
consumer in shape and framework. It was taken out with
`git archive v1.8.1 examples/nextjs-payload`, given the packed 2.0 build in
place of its `file:../..` dependency, and upgraded the way
[migration.md](../migration.md) says.

| Step                                                     | Result                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pll migrate`, dry run and `--write`                     | 3 source files read, **0 rewritten, 0 conflicts**, exit 0                                                                                                                                                                 |
| `tsc --noEmit`, `next build`                             | exit 0, exit 0                                                                                                                                                                                                            |
| the Next.js live-preview scenarios, app as migrated, dev | **4 of 5**, twice. React throws `Hydration failed` on every framed load and regenerates the tree, and the first write goes with it until the admin sends again; `inspect().hydration` is `{ mode: 'off', state: 'idle' }` |
| after one added line, `next dev` and `next start`        | **5 of 5** each, no page error, `inspect().hydration` `{ mode: 'react', state: 'committed' }`, `inspect().fidelity` `{ mode: 'escalate', unfaithful: 0, escalated: 0, fields: [] }`                                       |

The line is `hydration: 'react'` in the options the root layout passes to
`generateInlineScript()` ([ADR 0015](0015-first-write-after-hydration.md)). The
app imports a single name from the package, and 2.0 still exports it:
`generateInlineScript`, from the root entry, which is what the 1.8.1 README told
a Next.js site to use. The Next.js adapter writes the same value into every
script it emits — `livePreviewScriptProps()` with the same options serializes a
byte-identical configuration — so rendering through the adapter is the other
way to the same result. Under `next start` the unedited app won the race on the
measuring machine (the write at 64–67 ms stayed, both runs); in development it
lost both runs. The line turns an order that depends on timing into one the
runtime guarantees.

**What the upgrade does not deliver**, held against today's fixture: the bound
page is the same file byte for byte (`app/(inline)/page.tsx`), and the options
both layouts set agree. The upgraded app still sends the runtime to every
visitor — an anonymous `GET /` under `next start` is 244 804 B, the runtime
inline and again in the RSC payload, where today's fixture renders nothing for
that request through `<LivePreviewScript />` and `authorizePreview` — and it has
no fragment strategy and no reveal. `pll doctor --v2` says so (`LP0704`,
`LP0710`, no error-level finding). None of this is a 2.0 requirement for a
script built by hand: `strict` governs the adapters, and this app never used
one.

**Why the two apps count as two.** Sala's integration is server code: an Astro
SSR middleware with its own authorization, calling `isPreviewRequest()` and
`createPreviewBindings()`, and it uses neither an adapter nor the inline
runtime. Its upgrade was a rename in that middleware. App two has no server glue
at all: a React Server Component layout that builds the inline runtime by hand,
and a page React hydrates. Its upgrade renamed nothing and needed the one
runtime option that exists because React hydrates. Between them, the codemod's
rename path and the runtime's hydration path have each been through a real 1.x
app.

`tests/unit/migrate/app-two-nextjs-1.8.1.test.ts` keeps this from being a story
told once. It runs the codemod over the checked-in 1.8.1 files
(`tests/migration/nextjs-1.8.1/source/`) and holds the result against the
upgraded state (`expected/`) and against today's fixture. A codemod that starts
touching the app, a name it imports going missing, the one line no longer
making the difference, or the fixture's page or shared options drifting turns
it red.

## Addendum — the script names its defaults (2026-09-11)

`pll doctor --v2` read an empty slot of the inline configuration as the 1.x
value, and the 2.0 runtime reads it as the 2.0 one, so every 2.0 page with its
defaults left alone was reported four rows behind. What an empty slot stands for
is exactly what 2.0 changed, and nothing in the tuple said which generation had
written it.

The generator now resolves `defaults` itself and writes the result into a last
slot (24) of every script: `'v2'`, or `'v1'` when asked for. Under `'v1'` it also
writes the four 1.x runtime rows. Before, `generateInlineScript({ defaults: 'v1' })`
wrote the bytes of the 2.0 default and the page ran the 2.0 rows, although this
ledger and the migration guide said otherwise; the adapters resolved the rows
themselves and were not affected. The runtime does not read the slot, since
every row it decides already sits in its own. The doctor does: an empty slot takes
the value of the named generation, a script without the marker (1.x,
`2.0.0-beta.0`) is read as 1.x with an `info` line that says so, and a generation
it does not know is not judged. Reading the package version from the runtime was
rejected: under asset delivery it is not in the HTML, and a version only stands in
for the fact the doctor needs.

## Addendum (2026-10-03): protocol profile transport labels

`ProtocolProfile.populatesRelationships` keeps its `'admin' | 'server'`
values and existing defaults in 2.x. The `'admin'` value identifies the
Payload 2 schema-based transport; it is not a guarantee that the message
contains populated relationships. [ADR 0010](0010-protocol-capabilities-by-observation.md)
records the raw-ID observation and the collection-GET correction.
No public name, literal or default is removed for this bug fix. A future
replacement of these labels would require an additive API and a separately
reviewed 3.0 migration.

## Addendum (2026-10-17): what a conflict stops

Of the six codemods, `rename-is-preview-request` and `move-fetch-preview-helpers`
make no edit in a script that holds a spot they cannot rewrite; the other four
skip only that spot and rewrite the rest of the file. The CLI exits `3` for any
reported conflict, and `move-fetch-preview-helpers` also lists a note beside each
call it rewrote. [docs/migration.md](../migration.md) has the exact behaviour.
