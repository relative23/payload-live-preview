# ADR 0012 — Package topology and delivery profiles

**Status:** Accepted • **Date:** 2026-08-30

Records boundaries that were already enforced in code and in CI but had no
record of their own; the 2.0 readiness audit named this as the last of the five
decision records it required.

## Context

The package resolves to 20 export entries and reaches a page three different
ways. Until this record, which entry may import which was a property of
`scripts/architecture-rules.ts` and of whoever last read it. That is enough to
keep the tree correct and not enough to say _why_ a boundary exists, which is
what a reviewer needs when an import looks convenient.

Three questions kept recurring and are settled below: what may a browser bundle
contain, what does a consumer pay for an entry, and which entries are allowed to
need a peer dependency.

## Decision

### 1. Three groups, one rule each

**Runtime** — `.`, `./core`, `./client`, `./structural`, `./lexical`,
`./plugins`, `./fragment`. Ships to browsers. May not import a Node builtin and
may not import a server-only domain.

**Framework adapters** — `./astro`, `./nextjs`, `./sveltekit`, `./nuxt`, plus
the two Astro components and `./astro/middleware-entry`. Runs on the server of a
consumer's framework, but is written against web APIs so an edge runtime can
execute it.

**Server-only** — `./server`, `./payload`, `./codegen`, `./codegen/astro`,
`./doctor`, `./migrate`. Node is available here. Nothing in the first group may
reach these, and the check is mechanical: `SERVER_ONLY_DOMAINS` in
`scripts/architecture-rules.ts` raises `server-boundary` on the import and
`browser-node-builtin` on a Node builtin outside this group.

2026-09-14 (2.0.1): five entries came after this list. `./lean` (`src/lean.ts`)
is the lean inline runtime as a value and imports only the generated artifact
and a type. `./react` and `./vue` live under `src/adapters/` and follow the
adapter rules. `./annotate` (`src/tools/codegen/annotate/`) is server-only through its
domain, and `./nuxt-module` (`src/adapters/nuxt/module.ts`) through
`SERVER_ONLY_MODULES` in the same script, because Nuxt runs it in its build
process.

2026-11-28 (3.0): the three groups are folders. `src/runtime` is the first,
`src/adapters` the second, and `src/server` with `src/tools` the third. The
script reads the third group off a module's path (`SERVER_ONLY_ZONES`, in place
of the list of domains), so a module placed in one of the two folders is
server-only without an entry anywhere. `SERVER_ONLY_MODULES` stays for the Nuxt
module, an adapter file that runs in a build.

Type-only edges are exempt, because they are erased and cannot create runtime
coupling. That exemption is the reason the rule can stay strict without pushing
people into duplicating types.

### 2. The boundary is a graph rule, not a convention

`FORBIDDEN_RUNTIME_DOMAINS` additionally forbids _upward_ imports — the client
may not reach into `adapters`, `codegen`, `inline` or `payload`, and so on — so
the low-level runtime and security modules cannot acquire a dependency on the
layers built above them. The table names every domain a browser bundle or an
adapter can contain — `adapters`, `client`, `codegen`, `core`, `detection`,
`dsl`, `events`, `field-types`, `fragment`, `inline`, `lexical`, `payload`,
`plugins`, `schema`, `security` and `types` — because a domain without a
deny-list may import anything: `types` is a leaf that imports nothing at
runtime, and `core` may not reach `fragment`, which orchestrates above it.
Cycles are rejected in the same pass. A violation fails
`npm run test:architecture`, so a boundary cannot erode between reviews.

2026-11-28 (3.0): what crosses a zone is said once. `FORBIDDEN_ZONES` refuses an
import from `src/runtime` into `src/adapters`, `src/server` or `src/tools`, and
from `src/adapters` into `src/tools`. The list of a domain under `src/runtime`
names runtime domains only, and a new domain there is held to the zone before
it has a list.

### 3. Delivery profiles are sized, not described

The runtime reaches a page as a build-time-inlined IIFE (ADR 0001), as the
`LivePreviewClient` class, or through an adapter that injects the first. Only
the inline profile has a size a consumer cannot choose to avoid, so only it is
gated: `INLINE_BUDGET` and `INLINE_FRAGMENT_BUDGET` in `scripts/bundle-budgets.ts`
(raw, gzip and Brotli), both asserted on every push with the exact bytes the
release measures.
A budget is raised in the same commit as the feature that spends it, with the
reason in `scripts/bundle-budgets.ts` — the file reads as a ledger of what each
increase bought.

2026-09-14 (2.0.1): the inline profile is no longer the only one gated.
`scripts/check-bundle-size.ts` holds every JavaScript file in `dist/` to a raw,
gzip and Brotli budget from `ENTRY_BUDGETS` (`scripts/entry-budgets.ts`), and
fails on a file without one. The inline script is measured four ways —
`INLINE_BUDGET`, `INLINE_LEAN_BUDGET`, `INLINE_ROUTE_BUDGET` and
`INLINE_FRAGMENT_BUDGET`, all imported from `scripts/bundle-budgets.ts`.

2026-11-27 (3.0, ADR 0007 row 43): the package is one module graph, so a file
in `dist/` is an entry or a chunk several entries load, and a chunk's name
changes with its content. `scripts/check-bundle-size.ts` budgets an entry's
closure, its file with every chunk it loads (`scripts/entry-closure.ts`), and
the sum of all JavaScript files. It fails on an entry without a row, on a chunk
no entry loads and on a `require` condition in the manifest. What a consumer's
bundler keeps for one imported name stays with `scripts/check-tree-shaking.ts`.

### 4. Dual format where a consumer might still be on CommonJS

The runtime entries ship both `import` and `require`, and so do `./server`,
`./payload` and `./codegen`. The framework adapters are ESM-only because every
framework in the peer range is; `./annotate`, `./codegen/astro`, `./doctor` and
`./migrate` are ESM-only because they are tools a build or a maintainer runs,
not code a consumer bundles. The package is `"type": "module"` with `"sideEffects": false`, which is what lets a bundler
drop an unused entry rather than merely not call it.

2026-11-27 (3.0, ADR 0007 row 43): one format. Every entry is an ES module and
no CommonJS file is built: Node 24, the floor of 3.0, loads an ES module through
`require()` (measured on 24.0.0 and 24.22.3). The eleven entries a CommonJS file
could load before keep that: the ten that had a CommonJS build, and `./nextjs`,
which a `next.config.ts` compiled to CommonJS requires. Each carries a `default`
condition beside `import`, on the same file and the same declarations. The
other entries are for `import`, as they were. `./payload` is part of `./plugin`,
and `./doctor` and `./migrate` are the `pll` binary alone (rows 41 and 42).

Measured on the commit before and on this one: the JavaScript in the archive
goes from 2 798 814 to 540 940 bytes and the packed archive from 1 922 839 to
444 632. Beyond size it gives one instance of every module. A renderer
registered through `./lexical` is known to the root entry and to a module
loaded the other way; before, each entry had its own copy of the registry and
the root rendered a placeholder for that block. The package gate holds this
against the installed archive. An authorized context is recognised by a list
one module keeps, not by a key every copy had to agree on (ADR 0006).

The cost: an entry loads a shared chunk whole, with what its other readers
need, so its closure is larger than its bundled file was: by 3 to 6 % for the
root and the adapters, 14 % for `./core`, 21 and 23 % for the two hooks, 72 %
for `./plugins` and 120 % for `./fragment` (16 971 to 37 308 bytes). That is
what Node reads from disk for an import, and what a page without a bundler
fetches: `./client` is 19 files with 168 351 bytes where it was one file, and
such a page serves the folder. The plain-HTML production host of the test
suite copied the one file and failed in 5 of 8 cases until it copied the
entry with what it loads. What a bundler keeps for one imported
name is level: the twelve tree-shaking rows moved by between −286 and +112
bytes gzip.

Vite 8 bundles with Rolldown, and against the bundled entries it kept far more
than the name asked for. Measured with Vite 8.4.0 on the two packed archives,
one consumer per row: `escapeHtml` from the root goes from 983 to 219 bytes
gzip, `PluginManager` from `./plugins` from 3 945 to 3 275, `lexicalToHtml`
from the root from 6 685 to 6 055, and no row grows by more than 30 bytes.

### 5. A peer dependency is allowed only where it is optional

`astro` and `ts-morph` are both declared optional. `ts-morph` is needed to _run_
`pll migrate`, not to import `./migrate`'s types — which is why `Codemod`
describes a codemod without its `apply`. An entry that made a peer mandatory
would tax every consumer for a feature most never use, so it is not done.

2026-09-14 (2.0.1): seven peers are declared now, all of them optional in
`peerDependenciesMeta`: `astro`, `react`, `react-dom`, `svelte`, `ts-morph`,
`vite` and `vue`. 2026-11-03: `next`, for `payload-live-preview/nextjs/client`
alone, with the range `*` so that a Next.js canary installs beside it (ADR 0032).
2026-11-04 (2.4.1): `next` is no peer again; Next.js resolves the entry's import
of it to the app's own installation (ADR 0032, addendum).

## Consequences

- Each entry has an API report; 18 are committed under `etc/api/` (23 on
  2026-09-14, 2.0.1; 27 on 2026-11-03, with the three navigation entries of
  ADR 0032), and a change to a public surface fails the package gate until the
  report is regenerated and reviewed.
- Moving a module between groups is a visible event: it changes an API report,
  the architecture verdict, or both.
- The rules are structural, so they hold for code nobody re-reads. What they
  cannot check is whether an entry _earns_ its place; that stays a review
  question, and adding an entry is the one topology change this record asks to
  be argued rather than merely tested.

2026-11-27 (3.0): the `./lean` entry and its artifact are removed (ADR 0007,
row 37). The package builds one runtime; `INLINE_LEAN_BUDGET` and the generated
file that was committed for the entry leave with it, and no generated file is
committed any more.

2026-11-27 (3.0, rows 41 to 43): 23 API reports. API Extractor reads a copy of
the installed package outside `node_modules`, because it takes a declaration
chunk under `node_modules` for another package and then prints an entry's
exports as names without their signatures.

2026-11-27 (3.0, row 46): 20 API reports, and the chunks are drawn on purpose.
esbuild puts a module into the chunk of the set of entries that reach it, so
the entry table had also been the chunking. Rollup, Rolldown and esbuild drop
what a project does not use inside a file; webpack and Turbopack take a file
whole once one export of it is used. With the core, plugins and structural
entries merged into `./client`, the client, the plugin manager and the
built-in plugins had the same set and were one file of 123 596 bytes, and a
Next.js 16 app paid for it: 6.8 kB gzip more for `initLivePreview` under
Turbopack and under webpack, 17 kB for `PluginManager` where it had been 2.8.
The entry a name was imported from made no difference to either bundler; the
files did.

So every module that defines a name the root exports is built as an entry of
its own, 35 of them, read off the entries by `scripts/chunk-boundaries.ts`,
and the file of such an entry is removed after the build: nothing imports it.
The same app then ships what it shipped before the merge (47.5 kB for
`initLivePreview`, 2.8 kB for `PluginManager`, 1.2 kB for `morphElement`,
0.9 kB for one built-in plugin). The tree-shaking gate holds it with rows of
their own, measured from `dist` without a bundler: the chunk an entry takes a
name from and everything that chunk imports (`scripts/whole-file-budgets.ts`).
The cost is at the other end. There are 58 chunks where there were 39, a
boundary costs the import and export lists on both sides, and a page that
loads `./client` without a bundler fetches 43 files with 203 745 bytes; Vite
gives a project about half a percent more for the client and less for the
plugin manager.
