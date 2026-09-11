---
'payload-live-preview': patch
---

A 1.x project compiles against 2.0 without an edit.

Measured against the published 1.8.1 declarations rather than assumed, and entry by entry rather than at the root alone: of the 114 names the root entry exported, eight are absent from 2.0, and `./astro` lost four of its own. Seven of those moved behind `definePreview()` or changed shape — `fetchPreviewDocument()`, `fetchPreviewGlobal()` and their option types, and `CAPABILITY_REQUIREMENTS`. One was a plain rename, and that one is back on **both** entries that exported it: `isPreviewRequest` is a deprecated alias of `hasPreviewIntent`, removed in 3.0, so the most common 1.x import keeps working and an editor names the successor at the call site. `./astro` also regained `PreviewSignal`, which 2.0 had stopped re-exporting although the type still exists.

What is deliberately not aliased is everything whose _meaning_ changed rather than its name: the fetch helpers (`depth` was defaulted independently of the runtime's `mergeDepth`), `CAPABILITY_REQUIREMENTS` (a version map became a declaration table) and `NextMiddleware` (the middleware takes a response now). An alias there would type something the package no longer produces; TypeScript names each of them at the call site instead, and `docs/migration.md` says what to use. The fetch helpers deliberately have no alias: they defaulted `depth` to `1` independently of the runtime's `mergeDepth`, and a shim would restore the mismatch the move exists to remove.

Verified on a real 1.8.1 consumer, upgraded untouched: 201 Astro files, **0 errors**, two deprecation hints pointing at the two lines that name the old symbol. Before this change the same upgrade needed one hand edit, because `pll migrate` correctly refuses to rename into a module that already binds `hasPreviewIntent` — as that project's own wrapper did — and TypeScript's suggestion for the missing name was `PreviewRequestLike`.

`payload-live-preview/package.json` is exported now. `require('payload-live-preview/package.json')` is how tooling reads the installed version, and it answered `ERR_PACKAGE_PATH_NOT_EXPORTED`.
