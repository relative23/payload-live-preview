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

| #   | Version                            | Kind    | Old                                                                                                                                                                                                                                                                          | New                                                                                                                                                                                                                                                                                                        | Readiness row                                             | Codemod action                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.0                              | rename  | `isPreviewRequest(request, options)`                                                                                                                                                                                                                                         | `hasPreviewIntent(request, options)`; the 1.x name kept as a deprecated alias, removed in 3.0                                                                                                                                                                                                              | `hasPreviewIntent()` replaces `isPreviewRequest()`        | rewrite import and call sites; identical signature                                                                                                                                                                                                                                                                                            |
| 2   | 1.1.0                              | default | response changes gated on intent only                                                                                                                                                                                                                                        | `authorizePreview` required (`strict`, `'v2'`); refused verdict blocks injection, CSP and nonce exposure                                                                                                                                                                                                   | production response changes require an authorized context | none mechanical — flag the adapter call without `authorizePreview`                                                                                                                                                                                                                                                                            |
| 3   | 1.1.0                              | default | `previewSignals: ['query', 'fetch-dest', 'referer']`                                                                                                                                                                                                                         | `previewSignals: ['query']` under `'v2'`                                                                                                                                                                                                                                                                   | query-only intent signal                                  | add `previewSignals` explicitly where the old set is relied on                                                                                                                                                                                                                                                                                |
| 4   | 1.1.0                              | default | `allowedOrigins` optional                                                                                                                                                                                                                                                    | required and non-empty under `strict`/`'v2'`; must be `https:` outside development                                                                                                                                                                                                                         | explicit `allowedOrigins` required in production          | flag missing option                                                                                                                                                                                                                                                                                                                           |
| 5   | 1.1.0                              | default | runtime `disableReferrerDetection: false`                                                                                                                                                                                                                                    | `true` under `'v2'` (referrer trust off outside local dev)                                                                                                                                                                                                                                                 | referrer trust off outside local dev                      | add `disableReferrerDetection: true` where referrer trust is needed knowingly                                                                                                                                                                                                                                                                 |
| 6   | 1.1.0                              | default | messages accepted from any window that passes the origin check                                                                                                                                                                                                               | `eventSourcePolicy: 'parent-or-opener'` under `'v2'`                                                                                                                                                                                                                                                       | messages must come from parent/opener                     | add `eventSourcePolicy: 'any'` where a different window legitimately posts                                                                                                                                                                                                                                                                    |
| 7   | 1.1.0                              | default | `createPreviewBindings({ authorized: boolean })`                                                                                                                                                                                                                             | `createPreviewBindings({ authorization: AuthorizedPreviewContext \| null })`; the boolean is refused under `strict`                                                                                                                                                                                        | production response changes require an authorized context | rewrite `authorized: x` to `authorization: ctx` where `ctx` comes from `authorizePreviewRequest`                                                                                                                                                                                                                                              |
| 8   | 1.5.0                              | default | `skipUnchanged: false`                                                                                                                                                                                                                                                       | `true` under `'v2'`                                                                                                                                                                                                                                                                                        | skip unchanged bindings by default                        | none; add `skipUnchanged: false` to keep re-rendering identical values                                                                                                                                                                                                                                                                        |
| 9   | 1.2.0                              | move    | `fetchPreviewDocument()` / `fetchPreviewGlobal()` on the root entry (draft by default, `null` on failure)                                                                                                                                                                    | `definePreview({ serverURL, depth }).fetchDocument()` / `.fetchGlobal()` on `payload-live-preview/server` (explicit `authorization`, typed failure, `signal`, timeout)                                                                                                                                     | fetch helpers require explicit draft + authorization      | rewrite call sites onto `definePreview`; pass `authorization` where `draft` was computed                                                                                                                                                                                                                                                      |
| 10  | 1.2.0                              | default | `mergeDepth ?? 1` in the runtime and `depth ?? 1` in the fetch helpers, independently                                                                                                                                                                                        | `definePreview({ depth })` is required and feeds both; the 2.0 runtime default (`0` or explicit) is decided from measured consumer depths, not yet flipped by `'v2'`                                                                                                                                       | merge depth `0` or explicit                               | add `depth` to `definePreview`; spread `runtimeOptions` into the adapter                                                                                                                                                                                                                                                                      |
| 11  | 1.3.0                              | default | sanitizer `'compat'`: `id` and every `data-*` pass                                                                                                                                                                                                                           | `sanitizerPolicy: 'strict'` under `'v2'`: `id`, `name` and `data-payload-*` stripped, other `data-*` by `allowedDataAttributes`; Trusted Types policy `payload-live-preview` at every sink                                                                                                                 | hardened sanitizer `id`/`data-*` policy                   | add `sanitizerPolicy: 'compat'` where rich text relies on `id` or `data-*`; list the CSP `trusted-types` name                                                                                                                                                                                                                                 |
| 12  | 1.4.0                              | range   | Astro peer `>=4.0.0 <8.0.0`, with 4, 5, 6 and 7 each run in CI (ADR 0009)                                                                                                                                                                                                    | unchanged under `'v2'`; 2.0 narrows the range to the majors the CI matrix still runs at release time                                                                                                                                                                                                       | the tested majors only                                    | upgrade Astro to a major in the compatibility table before 2.0                                                                                                                                                                                                                                                                                |
| 13  | 2.0.0                              | rename  | `hasPreviewIntent(request, { adminOrigins })`                                                                                                                                                                                                                                | `{ allowedOrigins }` — the name the adapters, the client, the inline config and `pll doctor` use; `adminOrigins` stays a deprecated alias until 3.0 and loses when both are given                                                                                                                          | —                                                         | `rename-admin-origins-option` rewrites the key; both keys at once is a conflict, not a rewrite                                                                                                                                                                                                                                                |
| 14  | 2.0.0                              | rename  | `CachedElement.boundary`                                                                                                                                                                                                                                                     | `CachedElement.hidesWhenEmpty` — the `data-payload-boundary` anchor that hides while its field is empty; the old name read like a fragment boundary                                                                                                                                                        | —                                                         | none: a type-level rename that TypeScript reports; only a custom renderer that read the flag is affected                                                                                                                                                                                                                                      |
| 15  | 3.0 (planned, recorded 2026-09-19) | removal | `@internal` names the public entries still export at runtime — the root 28, `/core` 21, `/fragment` 19, `/structural` 15, `/codegen` 11, `/lexical` 5, `/migrate` 4, the adapters 2–3 each (API Extractor strips them from the `.d.ts` reports; the JavaScript exports them) | removed from the entries, or gathered behind one internal entry; a name a consumer reached for gets a public or `@beta` class in 2.1 first (2.1 plan, M9: a stability class per entry)                                                                                                                     | —                                                         | none until 3.0; `etc/api/*.api.md` lists every `@internal` name, so a consumer can see what will go                                                                                                                                                                                                                                           |
| 16  | 3.0 (planned, recorded 2026-09-19) | removal | `setSanitizerDocument()`, the process-wide document slot; deprecated since 2.1                                                                                                                                                                                               | a call names its document: `sanitizeHtml(html, { document })`, `lexicalToHtml(content, { document })`, `<RichText document={…} />`                                                                                                                                                                         | —                                                         | none until 3.0; `pll doctor` cannot see a server call, so the deprecation note on the declaration is the signal                                                                                                                                                                                                                               |
| 17  | 3.0 (planned, recorded 2026-09-29) | default | `subfieldCoverage: 'descendant'`: one bound path inside a group covers all of it                                                                                                                                                                                             | `'declared'`: each changed path inside a partly bound group needs a binding or a `data-payload-covers` declaration (ADR 0022); opt-in since 2.1                                                                                                                                                            | groups covered path by path                               | none mechanical — with the option on, LP0203 names each uncovered path; add `data-payload-covers` where a page shows part of a group on purpose                                                                                                                                                                                               |
| 18  | 3.0 (planned, recorded 2026-09-29) | default | `lexicalToHtml()` without a sanitizer document warns once and returns its markup unsanitised                                                                                                                                                                                 | `requireDocument: true`: throws `SanitizerEnvironmentError`, as `sanitizeHtml()` does (ADR 0025); opt-in since 2.1                                                                                                                                                                                         | server renders sanitised or refused                       | none mechanical — pass a `document` per call, or opt in and let the build name the renders without one                                                                                                                                                                                                                                        |
| 19  | 2.0.0                              | rename  | `onUnboundChange: 'route' \| 'ignore'`                                                                                                                                                                                                                                       | `onUnfaithfulPatch: 'escalate' \| 'ignore'`, which also covers patches that fail for other reasons; the old name stays a deprecated alias until 3.0, warns in development since 2.1 (ADR 0026) and loses when both are given                                                                               | —                                                         | `rename-on-unbound-change` rewrites the key and value; both keys at once, or a value that is not a literal, is a conflict                                                                                                                                                                                                                     |
| 20  | 2.0.0                              | rename  | `signed-token` `replay: { isUsed, markUsed }`                                                                                                                                                                                                                                | `replay: { consume }`: one check-and-record step; the two-method store stays until 3.0 and warns in development since 2.1 (ADR 0026)                                                                                                                                                                       | —                                                         | none: only the store can make the step atomic                                                                                                                                                                                                                                                                                                 |
| 21  | 3.0 (planned, recorded 2026-09-29) | removal | `defaults: 'v1'`, the 1.x profile                                                                                                                                                                                                                                            | the rows it stands for, written as options; warns in development since 2.1 (ADR 0026)                                                                                                                                                                                                                      | —                                                         | `expand-defaults-v1` writes the rows into the options literal; a spread before the key, a shared object used by an adapter and a client, or a JSX attribute is a conflict; since 3.0 it leaves out `strict: false` (row 36) and writes the preview signals without `'referer'`, the two the profile stood for that an adapter no longer takes |
| 22  | 3.0 (planned, recorded 2026-09-29) | default | `new OriginDetector()` trusts `document.referrer` unless told not to                                                                                                                                                                                                         | `enableReferrerDetection: false`; the package's own callers already pass the option; warns in development since 2.4 where a detector built without the option trusts a referrer                                                                                                                            | referrer trust off                                        | none: pass `enableReferrerDetection: true` where a hand-built detector relies on the referrer                                                                                                                                                                                                                                                 |
| 23  | 3.0 (planned, recorded 2026-09-29) | default | `RouteRefresh` may return `void`, taken as already committed                                                                                                                                                                                                                 | `() => Promise<void>` that settles after the host's commit; `LP0810` names a refresh that returns nothing since 2.1 (ADR 0028)                                                                                                                                                                             | —                                                         | none mechanical: a host that renders synchronously returns `Promise.resolve()`; an asynchronous one awaits its commit                                                                                                                                                                                                                         |
| 24  | 3.0 (planned, recorded 2026-10-17) | removal | `authorizePreview` and `shouldInject` on `LivePreviewAstroOptions`; 2.1 refuses them at startup in every mode                                                                                                                                                                | omitted from the type, as `NuxtModuleOptions` already omits them; `authorizePreviewModule` and `createLivePreviewMiddleware()` take their place                                                                                                                                                            | —                                                         | none: the options never ran in any mode, so no call has anything to rewrite                                                                                                                                                                                                                                                                   |
| 25  | 3.0 (planned, recorded 2026-10-26) | removal | Payload 2.x support (tested against 2.32.3), with what only Payload 2 needs: the schema-based field typing from `fieldSchemaJSON`, collection GETs for relationships, and the `documentInfo` callback arguments in the config plugin                                         | Payload 3.x and 4.x; every 2.x release of this package keeps supporting Payload 2                                                                                                                                                                                                                          | —                                                         | none: upgrading the CMS to Payload 3 is the migration                                                                                                                                                                                                                                                                                         |
| 26  | 3.0 (planned, recorded 2026-11-01) | default | `useLivePreviewDocument()` and `createDocumentSession()` merge every update an allowed admin sends, whichever document it is for; `document` is optional                                                                                                                     | `document` is required, so a hook merges only the document it names; one that follows every document has to say so; warns in development since 2.4                                                                                                                                                         | —                                                         | none mechanical: name the document the page rendered, `document: { collection, id }` or `{ global }`; the option exists since 2.3                                                                                                                                                                                                             |
| 27  | 3.0 (planned, recorded 2026-11-01) | default | a merge request has no deadline; `mergeTimeoutMs` and a hook's `timeoutMs` are off                                                                                                                                                                                           | both have a default deadline, proposed at 10 000 ms from the 2026-11-03 measurement (ADR 0026); a stalled merge is reported, and an explicit value still wins, `0` for none; warns in development since 2.4                                                                                                | —                                                         | none mechanical: set the values now to see the effect; a server that answers slowly needs a higher one                                                                                                                                                                                                                                        |
| 28  | 3.0 (planned, recorded 2026-11-01) | range   | `engines.node` `>=20.19.0`; Node 20 reached end of life on 2026-04-30                                                                                                                                                                                                        | Node 24 or newer, `>=24.0.0`                                                                                                                                                                                                                                                                               | —                                                         | none: move the build and the server to Node 24 or newer, which 2.x already runs on                                                                                                                                                                                                                                                            |
| 29  | 3.0 (planned, recorded 2026-11-01) | range   | the oldest framework versions are stated in the README and, for Astro, in the peer range                                                                                                                                                                                     | Next.js 15.5 and Nuxt 3 (kept working, not officially supported) are unchanged. SvelteKit and Astro changed through rows of their own, 34 and 35. A major leaves only through a row here                                                                                                                   | —                                                         | none                                                                                                                                                                                                                                                                                                                                          |
| 30  | 3.0 (planned, recorded 2026-11-01) | range   | `payload` peer `^2.0.0 \|\| ^3.0.0 \|\| ^4.0.0-0`                                                                                                                                                                                                                            | `^3.0.0 \|\| ^4.0.0`, with `^4.0.0-0` while Payload 4 is in pre-release; Payload 5 arrives in a 3.x minor of this package, not in a 4.0                                                                                                                                                                    | —                                                         | none beyond row 25: a site on Payload 3 or 4 changes nothing                                                                                                                                                                                                                                                                                  |
| 31  | 3.0 (planned, recorded 2026-11-03) | default | with a `locale` in `document`, `useLivePreviewDocument()` and `createDocumentSession()` still merge an update that names no locale; only one for another locale is left alone                                                                                                | an update that names no locale is left alone too, so a hook with a `locale` merges only the updates for that locale; `requireLocale: true` does it since 2.4, and a hook that merges such an update warns in development                                                                                   | —                                                         | none mechanical: Payload 3 and 4 name the admin's locale in every update when the config has localization; where updates name none, leave `locale` out                                                                                                                                                                                        |
| 32  | 3.0 (planned, recorded 2026-11-03) | removal | `livePreviewScriptProps()` without `delivery: 'asset'`: a synchronous helper that puts the whole runtime into every page that renders it, and into React's flight payload a second time                                                                                      | `await LivePreviewScript({ request, ...options })`, which renders nothing for a request it does not authorize, or `delivery: 'asset'`; `renderLivePreviewScript()` stays for HTML a server builds as a string; warns in development since 2.4                                                              | —                                                         |
| 33  | 3.0 (planned, recorded 2026-11-03) | default | the Astro integration delivers inline when `mode` is not set: the whole runtime in every page                                                                                                                                                                                | `mode: 'loader'`, a bootstrap that fetches the runtime only in a preview context; `mode: 'inline'` keeps the old delivery; warns in development since 2.4                                                                                                                                                  | —                                                         |
| 34  | 2.5.0                              | range   | SvelteKit 2 and 3, each installed by a CI job                                                                                                                                                                                                                                | SvelteKit 3. SvelteKit 2 is no longer tested: its release line has a high-severity advisory that is patched only in 3.1.1 (GHSA-3r8g-jcqq-3p5j). The adapter's code is unchanged, so a SvelteKit 2 project keeps the code it has, without a job that proves it. This replaces the SvelteKit part of row 29 | —                                                         | none: `npx sv migrate sveltekit-3` moves a project, and `docs/sveltekit.md` says what changes in the snippets                                                                                                                                                                                                                                 |
| 35  | 3.0                                | range   | `peerDependencies.astro` `>=4.0.0 <8.0.0`; Astro 4, 5 and 6 each installed by a CI job                                                                                                                                                                                       | `>=7.2.8 <8.0.0`. Astro releases only its current major, and Astro 4 to 6 carry a critical advisory that is patched only in 7.2.8 (GHSA-26w7-cxv4-gfx2), which is why the range begins there and not at 7.0.0. The base adapter runs at 7.2.8 on every push. This replaces the Astro part of row 29        | —                                                         | none: update Astro to 7.2.8 or newer with Astro's own upgrade guides; a project that stays on Astro 4 to 6 stays on 2.x                                                                                                                                                                                                                       |
| 36  | 3.0 (decided 2026-11-25)           | removal | `strict: false`: an adapter that changes a response on preview intent alone, without `authorizePreview`                                                                                                                                                                      | omitted from the type, which keeps `strict?: true`; an adapter that decides per request needs `authorizePreview`, non-empty `allowedOrigins` (`https:` in production) and no `'referer'` signal, and one given `strict: false` refuses to start                                                            | —                                                         | none: only the site can say who may see a preview; `pll doctor --v3` names the places and docs/authorization.md has the strategies                                                                                                                                                                                                            |

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
