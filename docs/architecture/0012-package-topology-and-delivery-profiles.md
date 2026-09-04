# ADR 0012 — Package topology and delivery profiles

**Status:** accepted, 2026-08-30. Records boundaries that were already enforced
in code and in CI but had no record of their own; the 2.0 readiness audit named
this as the last of the five decision records it required.

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

Type-only edges are exempt, because they are erased and cannot create runtime
coupling. That exemption is the reason the rule can stay strict without pushing
people into duplicating types.

### 2. The boundary is a graph rule, not a convention

`FORBIDDEN_RUNTIME_DOMAINS` additionally forbids _upward_ imports — the client
may not reach into `adapters`, `codegen`, `inline` or `payload`, and so on — so
the low-level runtime and security modules cannot acquire a dependency on the
layers built above them. Cycles are rejected in the same pass. A violation fails
`npm run test:architecture`, so a boundary cannot erode between reviews.

### 3. Delivery profiles are sized, not described

The runtime reaches a page as a build-time-inlined IIFE (ADR 0001), as the
`LivePreviewClient` class, or through an adapter that injects the first. Only
the inline profile has a size a consumer cannot choose to avoid, so only it is
gated: `INLINE_BUDGET` at 28 923 bytes gzip and `INLINE_FRAGMENT_BUDGET` at
32 693, both asserted on every push with the exact bytes the release measures.
A budget is raised in the same commit as the feature that spends it, with the
reason in `scripts/bundle-budgets.ts` — the file reads as a ledger of what each
increase bought.

### 4. Dual format where a consumer might still be on CommonJS

The runtime entries ship both `import` and `require`, and so do `./server`,
`./payload` and `./codegen`. The framework adapters are ESM-only because every
framework in the peer range is; `./doctor`, `./migrate` and `./codegen/astro`
are ESM-only because they are tools a maintainer runs, not code a consumer
bundles. The package is `"type": "module"` with `"sideEffects": false`, which is what lets a bundler
drop an unused entry rather than merely not call it.

### 5. A peer dependency is allowed only where it is optional

`astro` and `ts-morph` are both declared optional. `ts-morph` is needed to _run_
`pll migrate`, not to import `./migrate`'s types — which is why `Codemod`
describes a codemod without its `apply`. An entry that made a peer mandatory
would tax every consumer for a feature most never use, so it is not done.

## Consequences

- Each entry has an API report; 18 are committed under `etc/api/`, and a change
  to a public surface fails the package gate until the report is regenerated and
  reviewed.
- Moving a module between groups is a visible event: it changes an API report,
  the architecture verdict, or both.
- The rules are structural, so they hold for code nobody re-reads. What they
  cannot check is whether an entry _earns_ its place; that stays a review
  question, and adding an entry is the one topology change this record asks to
  be argued rather than merely tested.
