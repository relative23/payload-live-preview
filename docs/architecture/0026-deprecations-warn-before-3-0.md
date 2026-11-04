# ADR 0026 — What 3.0 removes warns in 2.x, and `pll migrate` writes it out

**Status:** Accepted • **Date:** 2026-09-29

Shipped in 2.1.0 (2026-10-23), after the full release chain ran on it.

This record makes every name and value that 3.0 removes say so while a 2.x
project still runs it, and adds the two rewrites `pll migrate` was missing.
Nothing is removed and no default changes.

## Context

3.0 removes six things that 2.x keeps working:

- `isPreviewRequest()` (ledger row 1) and the `adminOrigins` option of
  `hasPreviewIntent()` (row 13);
- `setSanitizerDocument()` (row 16);
- `onUnboundChange`, renamed to `onUnfaithfulPatch` in 2.0.0;
- the `signed-token` replay store `{ isUsed, markUsed }`, replaced by
  `{ consume }` in 2.0.0;
- `defaults: 'v1'`, which ADR 0007 keeps "through the 2.x line as the
  staged-migration escape hatch".

ADR 0007 §2 promised that an old name "emits one development warning per
process, never in production, that names the replacement". In 2.x none of
the six does. A project finds out from the 3.0 release notes, or from its
editor if it reads `@deprecated` tags. The two 2.0.0 renames are not in the
ledger, and `pll migrate` rewrites neither `onUnboundChange` nor
`defaults: 'v1'`, although both are mechanical.

## Decision

### 1. One development warning per deprecated form

Each of the six warns once per process outside production, through the
`warnOnce` the adapters already use: `NODE_ENV` is not `production` (an
unset `NODE_ENV` counts as development too, corrected 2026-10-30; without a
`process.env` nothing warns), and the issued keys live on `globalThis`, so two copies of the
package in one process warn once. The helper moves from `adapters/shared` to
`types`, the leaf that the sanitizer and the token strategy may import. The
warning names the replacement, says that 3.0 removes the old form, and names
the codemod when there is one. It fires where the package sees the old form:

| Old form                             | Warns when                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `isPreviewRequest()`                 | it is called                                                               |
| `hasPreviewIntent({ adminOrigins })` | it is called with the option                                               |
| `setSanitizerDocument()`             | it is called                                                               |
| `onUnboundChange`                    | an adapter or `generateInlineScript()` is given it                         |
| `replay: { isUsed, markUsed }`       | a `signed-token` strategy checks a token against a store without `consume` |
| `defaults: 'v1'`                     | an adapter or `generateInlineScript()` is given it                         |

An adapter hands both options on to the generator; the shared key keeps that
to one line. `isPreviewRequest` becomes a function that warns and calls
`hasPreviewIntent`, so it is no longer the same value; its type is.

A browser-only configuration (`initLivePreview()`, `LivePreviewClient`) does
not warn: a browser has no reliable development signal, and every byte of the
runtime reaches every preview. There the declarations carry `@deprecated`,
the codemods cover both options, and `pll doctor --v2` already names every
row of a page generated under `'v1'` (LP0709); its remedy now adds that 3.0
removes the profile and that `pll migrate` writes it out.

### 2. Two codemods

Both rewrite options literals that the file hands to the package: a literal
passed to a function or class the file binds from it, and a `const` object
literal such a call takes by name or spreads, the shape that shares options
between two adapters. An options object built in a file that does not hand
it to the package is not seen; the warning names it at run time.

- `rename-on-unbound-change` (ledger row 19): `onUnboundChange: 'route'`
  becomes `onUnfaithfulPatch: 'escalate'`, and `'ignore'` stays `'ignore'`.
  Both keys at once, or a value that is not a literal, is a conflict for a
  human, as in `rename-admin-origins-option`.
- `expand-defaults-v1` (ledger row 21): `defaults: 'v1'` is replaced by the
  rows it stands for that the literal does not set: `strict: false` and
  `previewSignals: ['query', 'fetch-dest', 'referer']` for an adapter entry's
  options, then `disableReferrerDetection: false`, `eventSourcePolicy: 'any'`,
  `skipUnchanged: false` and `sanitizerPolicy: 'compat'`, and
  `mergeDepth: 1` where `serverURL` is set or could be and no depth is, which
  is what `'v1'` read an omitted depth as. The entry decides the kind: the
  API reports show adapter options only on the four adapter entries and the
  Nuxt module, and runtime options only on the root, `core` and `client`; a
  test holds the codemod's table to them.
  The rewrite changes no behaviour: every row keeps the value the profile
  gave it, now where a reviewer and `pll doctor` see it. It refuses where a
  written row would override something the profile yielded to: a spread
  before the key, a caller that sets a row or names its own `defaults`
  before spreading the shared object, or one object shared by an adapter and
  a client. A JSX attribute is reported, not rewritten.

A Nuxt project sets module options in `nuxt.config`, which imports nothing
from the package; the migration guide says so.

### 3. The ledger records the rest

Rows 19 to 22: the two 2.0.0 renames, the removal of `defaults: 'v1'` in 3.0,
and the `OriginDetector` default that 3.0 flips to
`enableReferrerDetection: false`. The package's own callers already pass
that option; a consumer who builds a detector opts in now by passing it.

## Alternatives

- **Warn in the browser too.** It costs every preview the bytes, and a
  hostname is not a development signal.
- **Warn in production.** A line per process in production is noise the
  operator did not ask for; ADR 0007 §2 ruled it out.
- **Remove `defaults: 'v1'` in 2.1.** A breaking change on a minor release.

## Consequences

- Six development warnings. A test that uses a deprecated form in
  development sees one more line; the intent-only warning's test counts it.
- `pll migrate` has six codemods. The `astro-hybrid` fixture, which shares
  `defaults: 'v1'` and `onUnboundChange` between two middlewares, is migrated
  by them and passes its browser suites unchanged. The Nuxt fixture keeps the
  profile until the Nuxt work of its own; its options object is the case the
  codemod cannot see.
- Acceptance: unit tests for each warning (once, silent in production, the
  replacement named) and each codemod (rewrites, refusals, idempotence); the
  migrated fixture in three browsers; the full chain, the nightly and the core
  scope, since the sanitizer changed.

## Addendum (2026-10-31): the end of Payload 2 support warns in the browser

Ledger row 25 said nothing at run time, because no option or name in a project
marks it as being on Payload 2. The message does: `fieldSchemaJSON` is the Payload
2 signature `src/core/protocol-profile.ts` already reads. The first such update
warns once per runtime and once per hook session.

This warning does not use `warnOnce`. It runs in the browser, where an inline
script has no `process.env`, so `warnOnce` would never fire there. It uses
`isDevMode()`, which falls back to `localhost` and `127.0.0.1` where `NODE_ENV`
cannot be read. A staging preview on another host hears nothing.

The lean inline profile leaves the warning out, as it leaves out other
features, and Payload 2 behaves there as before. Nothing else on Payload 2 changes.

## Addendum (2026-11-03): the defaults 3.0 changes warn too, in 2.4

Up to 2.3 four rows that change a default said nothing at run time: the
referrer trust of `new OriginDetector()` (row 22), a hook without `document`
(row 26), a merge without a deadline (row 27) and an update without a locale
merged by a hook with one (row 31). Since 2.4 each says so once in
development, and only where 3.0 would behave differently. Two new rows join
them and warn from the start: inline delivery through `livePreviewScriptProps()`
(row 32) and the Astro integration's inline default, which 3.0 replaces with
`loader` (row 33).

| Row | Warns when                                                                                        | Where                                     | Silenced by                                         |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| 22  | a detector built without `enableReferrerDetection`, with no origins of its own, read a referrer   | the browser, once per page                | passing the option either way                       |
| 26  | a hook or `createDocumentSession()` starts listening without `document`                           | the browser, once per page                | `document`                                          |
| 27  | a hook starts listening without `timeoutMs`; an adapter or the generator gets no `mergeTimeoutMs` | the browser; the server, once per process | any value, `0` for none                             |
| 31  | a hook with `document.locale` merged an update that names no locale                               | the browser, once per page                | `requireLocale: true`, which is 3.0's behaviour     |
| 32  | `livePreviewScriptProps()` renders the whole runtime                                              | the server, once per process              | `await LivePreviewScript(…)` or `delivery: 'asset'` |
| 33  | `livePreview()` runs without `mode`                                                               | the server, once per process              | `mode: 'inline'` or `mode: 'loader'`                |

The browser rows go through a per-page counterpart of `warnOnce` whose keys
live on `globalThis`. Each reads `process.env.NODE_ENV` in place and with a
dot, the expression a bundler replaces: a development build speaks, and a
production build drops the notice together with its text. Where nothing
replaced the expression and there is no `process`, as on a page that loads the
module without a bundler, the read throws inside the guard and nothing is
said. Every runtime artefact is built with `NODE_ENV` set to `production`, so
the inline runtime carries none of these rows. Rows 32 and 33 measure their
bytes from what they generated, so the warning names the project's own sizes.

**What the browser rows cost a visitor, measured.** Until 2026-11-04 these rows
asked `isDevMode()` at run time, as the Payload 2 notice does, so their text
reached every visitor. Since then they read `NODE_ENV` in place. A consumer's
Vite production build of one import from `dist` (Node 24.22.1), before and
after:

| Import                           | gzip before | gzip after | Notice text after |
| -------------------------------- | ----------- | ---------- | ----------------- |
| `useLivePreviewDocument`, React  | 8 693 B     | 8 357 B    | none              |
| `useLivePreviewDocument`, Vue    | 8 601 B     | 8 264 B    | none              |
| `createDocumentSession`, `/core` | 8 368 B     | 8 025 B    | none              |
| `initLivePreview`, `/client`     | 53 943 B    | 53 808 B   | none              |

The same sources with every notice block deleted bundle to the same raw size
under esbuild, Vite's minifier (gzip within 5 B, from renamed identifiers), and
to the same raw and gzip size under the SWC minifier of Next.js 16.4.3: the
guards leave nothing behind. The tree-shaking gate now defines `NODE_ENV` as a
production build does, and `tests/unit/adapters/dev-notices-production-build.test.ts`
holds both modes.

**Row 27's default, measured.** On 2026-11-03 the merge request, the runtime's
`POST /api/<collection>/<id>` with `X-Payload-HTTP-Method-Override: GET`, was
timed against Payload 3.92.1 under `next dev` (Next.js 16.4.3, PostgreSQL 18
with PostGIS, TLS through Traefik) on 16 documents of a site with layout
blocks, at depth 0, 1 and 2:

| Case                                | Requests | p50      | p99       | Slowest  |
| ----------------------------------- | -------- | -------- | --------- | -------- |
| one editor, one merge after another | 300      | 8–11 ms  | 32–36 ms  | 42 ms    |
| eight editors at once               | 960      | 37–49 ms | 93–112 ms | 130 ms   |
| the first API request after a start | 3        | —        | —         | 1 463 ms |

The first merge after that first request took 20 to 23 ms. A default of
10 000 ms leaves about seven times the slowest request measured. Not measured:
a CMS across a network, a serverless cold start, and Payload 2, whose merge
is a series of requests that one deadline covers together. The value is set
before 3.0; 2.x keeps no default.
