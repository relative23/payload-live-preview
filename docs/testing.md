# Testing and quality gates

This project treats tests as executable contracts, not as a test-count target. A
line is not considered protected merely because coverage reached it: critical
code also has mutation, generative, artifact, and real-browser checks appropriate
to its failure mode.

## Local commands

After `npm ci`, generate the ignored inline runtime once:

```sh
npm run build:runtime
```

The common maintainer commands are:

| Command                         | Contract                                                                  |
| ------------------------------- | ------------------------------------------------------------------------- |
| `npm run check`                 | Types, typed lint, test policy, architecture/dead-code policy, Vitest     |
| `npm run format:check`          | Source, config, workflow, fixture, and packed type-fixture formatting     |
| `npm run test:coverage`         | Global and critical-file coverage floors                                  |
| `npm run test:coverage:diff`    | Changed executable lines and monotonic threshold ratchets                 |
| `npm run test:package`          | Exact tarball, API reports, publint, ATTW, imports, CLI, and type clients |
| `npm run test:mutation`         | PR-sized Stryker mutation profile                                         |
| `npm run test:property`         | Deterministic fast-check security and lifecycle models                    |
| `npm run test:e2e`              | Chromium, Firefox, and WebKit behavior plus accessibility assertions      |
| `npm run test:e2e:real-payload` | Real Payload admin-to-preview protocol                                    |
| `npm run test:leak`             | 10,000 awaited updates, forced-GC heap, and exact resource ownership      |
| `npm run test:soak`             | Built-runtime Chromium update/heap soak                                   |
| `npm run test:bench:codspeed`   | Versioned CPU/allocation trend inputs                                     |

`npm run api:update` is intentionally not a routine formatter. It rebuilds and
repacks the project, regenerates API Extractor reports from the installed archive,
and leaves a reviewable public-surface diff. Run it only for an intentional API
change and include the matching Changeset.

For a release candidate, CI derives `SOURCE_DATE_EPOCH` from the tested commit,
builds once, and runs:

```sh
npm run test:package -- --artifact-dir release-artifact --source-commit "$TESTED_SHA"
```

This writes one checked tgz and `package-artifact.json`. The manifest binds the
package identity, commit, source epoch, exact Node/npm toolchain, raw archive
SHA-1/SHA-256/SHA-512 integrity, sizes, and complete path/size/mode inventory.
The privileged release workflow downloads only that immutable artifact from the
triggering CI run and re-runs the full package gate with `--tarball`; this mode
inspects the supplied bytes and never packs the checkout.

Publishing passes those same tgz bytes directly to npm with lifecycle scripts
disabled and OIDC provenance enabled. Before any tag or GitHub Release is
created, the workflow compares npm's `dist.integrity`, downloads the registry
tgz, and verifies its raw digests and inventory against the CI manifest. A rerun
may reconcile a matching npm version with a missing tag/release, but a registry
version with different bytes fails closed. Prerelease publishing is deliberately
blocked until an explicit non-`latest` dist-tag policy is reviewed.

## Quality map

| Risk                                      | Primary evidence                                                         | Lane           |
| ----------------------------------------- | ------------------------------------------------------------------------ | -------------- |
| Type/API compatibility                    | strict `tsc`, negative packed type fixtures, API Extractor reports       | pull request   |
| Package/module-resolution drift           | exact tgz, publint, ATTW, isolated ESM/CJS/NodeNext consumers            | pull request   |
| Parser, trust-boundary, and race mistakes | fixed regressions, fast-check properties/models, critical mutation tests | PR + scheduled |
| Untested edits                            | critical per-file floors and changed-line LCOV gate                      | pull request   |
| Layer erosion and dead code               | source dependency graph, cycle rules, Knip                               | pull request   |
| Browser/DOM differences                   | Playwright in Chromium, Firefox, WebKit and a real Payload application   | pull request   |
| Accessibility regressions                 | semantic live-region assertions and Axe WCAG A/AA scans                  | pull request   |
| Algorithmic or bundle regressions         | deterministic size/complexity gates and CodSpeed trends                  | PR + trend     |
| Resource retention                        | exact handle counts, forced-GC Node leak gate, Chromium heap soak        | scheduled      |
| Protocol ecosystem drift                  | captured real messages and pinned/latest/canary Payload watch            | PR + scheduled |

The machine-readable inventory is [quality/test-inventory.json](../quality/test-inventory.json).
It is regenerated with `tsx scripts/test-policy.ts --write`; CI fails if it is
stale. Focused, skipped, conditional, todo, and expected-failure declarations
have a budget of zero. Playwright retries may collect diagnostics, but
`failOnFlakyTests` prevents a retry from turning a flaky test into a passing gate.

## Coverage and mutation policy

[quality/coverage-policy.json](../quality/coverage-policy.json) is a ratchet:
global thresholds cannot be lowered, a critical-file baseline cannot disappear,
and changed lines have an independent floor. CI compares against the reviewed
base SHA and fails closed when that SHA or an LCOV source record is unavailable.

Coverage is deliberately complemented by Stryker. The small PR profile protects
the highest-risk pure boundaries on every change; the scheduled profile expands
to sanitizer, origin, message ordering, scheduler, and plugin ownership. See
[mutation and property testing](testing/mutation-and-property-testing.md) for the
reproducible seeds, profiles, and baseline. A surviving mutant is not waived by
lowering a threshold: add a meaningful invariant, remove unreachable code, or
record a narrowly reviewed equivalent mutant with an owner and review date.

## Scheduled performance and leak gates

The deep-quality workflow runs 10,000 property cases per property, the expanded
mutation profile, and 10,000 fully awaited updates in a long-lived runtime under
forced GC, in addition to repeated start/destroy ownership churn. The Node gate
requires all owned observers, listeners, timers, and DOM nodes to return to zero
and both long-session and post-destroy retained heap drift to remain below 2 MiB.

The Chromium soak always performs at least 10,000 real `postMessage` updates. It
runs for five minutes on ordinary nights and thirty minutes weekly, asserts
latest-write behavior and no page errors, forces collection through CDP, and caps
retained renderer heap drift at 8 MiB. Chromium provides the heap measurement;
all three browser engines remain required for functional correctness.

CodSpeed records controlled relative trends. It is not a hard nanosecond gate
until enough repository history exists to calibrate stable thresholds. Absolute
raw/gzip/Brotli package budgets and deterministic algorithmic invariants remain
hard gates throughout that calibration period.

## Failure handling

- Every randomized failure must retain its seed and shrink path. Add the minimal
  counterexample as a deterministic regression before fixing production code.
- Required and release lanes tolerate no skip, focus, expected-failure, or flaky
  success. A temporary quarantine requires an issue, owner, and expiry and cannot
  make a release green.
- Do not approve an API report, package snapshot, mutation exception, coverage
  reduction, or bundle-budget increase as an unexplained mechanical update.
- Keep fast pull-request gates deterministic. Expensive exploration, heap sampling,
  and long soaks belong in scheduled lanes, with reports retained for diagnosis.
