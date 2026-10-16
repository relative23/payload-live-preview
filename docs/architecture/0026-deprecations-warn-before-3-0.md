# ADR 0026 — What 3.0 removes warns in 2.x, and `pll migrate` writes it out

**Status:** Proposed • **Date:** 2026-09-29

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
`warnOnce` the adapters already use: `NODE_ENV` is set and is not
`production`, and the issued keys live on `globalThis`, so two copies of the
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
  profile until its own unit (H18); its options object is the case the
  codemod cannot see.
- Acceptance: unit tests for each warning (once, silent in production, the
  replacement named) and each codemod (rewrites, refusals, idempotence); the
  migrated fixture in three browsers; the full chain, the nightly and the core
  scope, since the sanitizer changed.
