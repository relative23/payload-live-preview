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
until 3.0 (`src/adapters/shared/preview-request-legacy.ts`), as the ledger row
says.

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

| #   | Version | Kind    | Old                                                                                                       | New                                                                                                                                                                                        | Readiness row                                             | Codemod action                                                                                                |
| --- | ------- | ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.0   | rename  | `isPreviewRequest(request, options)`                                                                      | `hasPreviewIntent(request, options)`; the 1.x name kept as a deprecated alias, removed in 3.0                                                                                              | `hasPreviewIntent()` replaces `isPreviewRequest()`        | rewrite import and call sites; identical signature                                                            |
| 2   | 1.1.0   | default | response changes gated on intent only                                                                     | `authorizePreview` required (`strict`, `'v2'`); refused verdict blocks injection, CSP and nonce exposure                                                                                   | production response changes require an authorized context | none mechanical — flag the adapter call without `authorizePreview`                                            |
| 3   | 1.1.0   | default | `previewSignals: ['query', 'fetch-dest', 'referer']`                                                      | `previewSignals: ['query']` under `'v2'`                                                                                                                                                   | query-only intent signal                                  | add `previewSignals` explicitly where the old set is relied on                                                |
| 4   | 1.1.0   | default | `allowedOrigins` optional                                                                                 | required and non-empty under `strict`/`'v2'`; must be `https:` outside development                                                                                                         | explicit `allowedOrigins` required in production          | flag missing option                                                                                           |
| 5   | 1.1.0   | default | runtime `disableReferrerDetection: false`                                                                 | `true` under `'v2'` (referrer trust off outside local dev)                                                                                                                                 | referrer trust off outside local dev                      | add `disableReferrerDetection: true` where referrer trust is needed knowingly                                 |
| 6   | 1.1.0   | default | messages accepted from any window that passes the origin check                                            | `eventSourcePolicy: 'parent-or-opener'` under `'v2'`                                                                                                                                       | messages must come from parent/opener                     | add `eventSourcePolicy: 'any'` where a different window legitimately posts                                    |
| 7   | 1.1.0   | default | `createPreviewBindings({ authorized: boolean })`                                                          | `createPreviewBindings({ authorization: AuthorizedPreviewContext \| null })`; the boolean is refused under `strict`                                                                        | production response changes require an authorized context | rewrite `authorized: x` to `authorization: ctx` where `ctx` comes from `authorizePreviewRequest`              |
| 8   | 1.5.0   | default | `skipUnchanged: false`                                                                                    | `true` under `'v2'`                                                                                                                                                                        | skip unchanged bindings by default                        | none; add `skipUnchanged: false` to keep re-rendering identical values                                        |
| 9   | 1.2.0   | move    | `fetchPreviewDocument()` / `fetchPreviewGlobal()` on the root entry (draft by default, `null` on failure) | `definePreview({ serverURL, depth }).fetchDocument()` / `.fetchGlobal()` on `payload-live-preview/server` (explicit `authorization`, typed failure, `signal`, timeout)                     | fetch helpers require explicit draft + authorization      | rewrite call sites onto `definePreview`; pass `authorization` where `draft` was computed                      |
| 10  | 1.2.0   | default | `mergeDepth ?? 1` in the runtime and `depth ?? 1` in the fetch helpers, independently                     | `definePreview({ depth })` is required and feeds both; the 2.0 runtime default (`0` or explicit) is decided from measured consumer depths, not yet flipped by `'v2'`                       | merge depth `0` or explicit                               | add `depth` to `definePreview`; spread `runtimeOptions` into the adapter                                      |
| 11  | 1.3.0   | default | sanitizer `'compat'`: `id` and every `data-*` pass                                                        | `sanitizerPolicy: 'strict'` under `'v2'`: `id`, `name` and `data-payload-*` stripped, other `data-*` by `allowedDataAttributes`; Trusted Types policy `payload-live-preview` at every sink | hardened sanitizer `id`/`data-*` policy                   | add `sanitizerPolicy: 'compat'` where rich text relies on `id` or `data-*`; list the CSP `trusted-types` name |
| 12  | 1.4.0   | range   | Astro peer `>=4.0.0 <8.0.0`, with 4, 5, 6 and 7 each run in CI (ADR 0009)                                 | unchanged under `'v2'`; 2.0 narrows the range to the majors the CI matrix still runs at release time                                                                                       | the tested majors only                                    | upgrade Astro to a major in the compatibility table before 2.0                                                |
| 13  | 2.0.0   | rename  | `hasPreviewIntent(request, { adminOrigins })`                                                             | `{ allowedOrigins }` — the name the adapters, the client, the inline config and `pll doctor` use; `adminOrigins` stays a deprecated alias until 3.0 and loses when both are given          | —                                                         | `rename-admin-origins-option` rewrites the key; both keys at once is a conflict, not a rewrite                |
| 14  | 2.0.0   | rename  | `CachedElement.boundary`                                                                                  | `CachedElement.hidesWhenEmpty` — the `data-payload-boundary` anchor that hides while its field is empty; the old name read like a fragment boundary                                        | —                                                         | none: a type-level rename that TypeScript reports; only a custom renderer that read the flag is affected      |

2026-09-16 (2.0.1): row 5's "outside local dev" names an exception the runtime
does not have. `disableReferrerDetection` is `true` everywhere under `'v2'`;
the localhost matcher is a separate option (`disableLocalhostMatching`), and
the readiness label and docs/migration.md say "referrer trust off".

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
