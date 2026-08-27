# ADR 0007 — 2.0 defaults, migration policy, and the renames ledger

**Status:** Accepted • **Date:** 2026-08-27 (started; appended to by every change that renames, moves, re-defaults or removes something)

## Context

2.0 does not add capability. It flips defaults and removes ambiguity. That is
only a safe release if every 2.0 default already exists in 1.x as an opt-in,
is tested in both modes, and has a mechanical migration. A migration tool
written from memory at 2.0 time would miss the small renames; this record is
the ledger it is generated from instead. The 1.9.0 readiness audit in the
private roadmap lists the defaults; this file lists the _changes_, one entry
each, in the order they landed.

## Decision

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
| 1   | 1.1.0   | rename  | `isPreviewRequest(request, options)`                                                                      | `hasPreviewIntent(request, options)`                                                                                                                                                       | `hasPreviewIntent()` replaces `isPreviewRequest()`        | rewrite import and call sites; identical signature                                                            |
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
