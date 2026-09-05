# Architecture decision records

One file per decision, numbered in the order they were written. A record is
not rewritten to say something different later; a later record supersedes it
and says so. Under each title stands one status line in one form:

`**Status:** Accepted • **Date:** YYYY-MM-DD`

with the date the decision was taken. Anything else the status used to carry —
what a record supersedes, why it has the number it has — is a sentence of its
own below the line. Every record here is accepted; a superseded or rejected
one would say so in the same line.

| No.                                                    | Title                                                                         | Decision                                                                                                                | Status                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [0001](0001-single-source-runtime.md)                  | Single-source build-time-inlined runtime                                      | One `src/core/runtime.ts` is bundled and baked into the inline, loader and fragment files the adapters ship.            | Accepted                 |
| [0002](0002-per-instance-isolation.md)                 | Per-instance isolation over module singletons                                 | Every stateful primitive is a class; two DOM-keyed `WeakMap`s are the only module-scope state.                          | Accepted                 |
| [0003](0003-memory-leak-discipline.md)                 | Memory-leak discipline                                                        | DOM-keyed passive metadata lives in weak collections; active-work state is bounded and cleared on stop/destroy.         | Accepted                 |
| [0004](0004-revision-and-cancellation.md)              | Revision and cancellation semantics                                           | Work identity is an attachment generation plus a monotonic revision, carried through the whole update pipeline.         | Accepted                 |
| [0005](0005-plugin-resource-ownership.md)              | Plugin resource ownership and transform ordering                              | Each plugin registration owns a resource scope, staged until `init()` resolves and released with the plugin.            | Accepted                 |
| [0006](0006-authorized-preview-context.md)             | Authorized preview context: threat model and authorization strategies         | A branded `AuthorizedPreviewContext`, produced only by `authorizePreviewRequest()`, gates every privileged read.        | Accepted                 |
| [0007](0007-v2-defaults-and-renames-ledger.md)         | 2.0 defaults, migration policy, and the renames ledger                        | Every rename, move and re-default is one ledger entry; `pll migrate` is generated from the ledger.                      | Accepted, shipped in 2.0 |
| [0008](0008-keyed-morph-ownership.md)                  | Keyed morph: what it keeps, what it never crosses                             | A conservative keyed morph that never enters islands, `contenteditable` or consumer-owned subtrees.                     | Accepted                 |
| [0009](0009-astro-peer-range.md)                       | The Astro peer range is what CI runs                                          | `peerDependencies.astro` covers exactly the majors the CI matrix installs; the README table is rendered from CI.        | Accepted                 |
| [0010](0010-protocol-capabilities-by-observation.md)   | Protocol capabilities are observed, and Payload versions sit behind a profile | Capabilities activate by announced version or by what the wire shows; Payload-specific behaviour sits behind a profile. | Accepted                 |
| [0011](0011-fragment-protocol-and-abuse-model.md)      | The fragment protocol and its abuse model                                     | Server-rendered fragments require authorization; the client never sends code, paths or templates.                       | Accepted                 |
| [0012](0012-package-topology-and-delivery-profiles.md) | Package topology and delivery profiles                                        | Three entry groups with mechanical import boundaries; only the inline profile carries a size budget.                    | Accepted                 |
| [0013](0013-release-pipeline.md)                       | Release pipeline                                                              | Only the artifact a certified CI run produced is published, byte-identical, and a rerun reconciles rather than repeats. | Accepted                 |
