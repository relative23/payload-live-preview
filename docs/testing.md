# Testing and quality gates

This project treats tests as executable contracts, not as a test-count target. A
line is not considered protected merely because coverage reached it: critical
code also has mutation, generative, artifact, and real-browser checks appropriate
to its failure mode.

## Local commands

After `npm ci`, generate the ignored inline runtime files
(`src/inline/runtime.generated.ts`, `loader.generated.ts`,
`fragment.generated.ts`) once:

```sh
npm run build:runtime
```

`npm test` regenerates them through its `pretest` hook. The narrower scripts
(`npm run test:unit`, `test:integration`, `typecheck`) do not — npm runs a
`pre` hook only for the script that shares its name — so run `build:runtime`
yourself after pulling a change to `src/core/runtime.ts`. Every CI job that
type-checks or runs tests runs it explicitly for the same reason.

The common maintainer commands are:

| Command                         | Contract                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run check`                 | Types, lint, formatting, test policy, architecture/dead-code policy, compat and diagnostic tables, Vitest |
| `npm run format:check`          | Source, config, workflow, fixture, and packed type-fixture formatting                                     |
| `npm run test:coverage`         | Global and critical-file coverage floors                                                                  |
| `npm run test:coverage:diff`    | Changed executable lines and monotonic threshold ratchets                                                 |
| `npm run test:package`          | Exact tarball, API reports, publint, ATTW, imports, CLI, and type clients                                 |
| `npm run test:mutation`         | PR-sized Stryker mutation profile                                                                         |
| `npm run test:property`         | Deterministic fast-check security and lifecycle models                                                    |
| `npm run test:e2e`              | Chromium, Firefox, and WebKit behavior plus accessibility assertions                                      |
| `npm run test:e2e:real-payload` | Real Payload admin-to-preview protocol                                                                    |
| `npm run test:leak`             | 10,000 awaited updates, forced-GC heap, and exact resource ownership                                      |
| `npm run test:soak`             | Built-runtime Chromium update/heap soak                                                                   |
| `npm run test:bench:codspeed`   | Versioned CPU/allocation trend inputs                                                                     |

### The nightly mutation scope

`npm run test:mutation` mutates the small PR profile. The release-critical scope
is every file with a per-file coverage baseline (`quality/coverage-policy.json`)
plus the PR profile's three files and `src/core/a11y.ts`; `stryker.config.js`
builds that union at startup. The reviewed file list, mutant total and score are
pinned in `quality/mutation-policy.json` — that file is the baseline, not this
page:

```sh
STRYKER_SCOPE=nightly npm run test:mutation
```

That scope is too large for one CI job — about 250 minutes on a GitHub runner —
so the workflow runs it in six shards and grades the joined report:

```sh
STRYKER_SCOPE=nightly STRYKER_SHARD=1/6 npm run test:mutation   # …2/6 … 6/6
npx tsx scripts/merge-mutation-reports.ts --out test-results/stryker-nightly.json \
  test-results/stryker-nightly-shard{1,2,3,4,5,6}.json
npm run test:mutation:policy
```

The merge refuses reports from different configurations, or a file two shards
both claim. Adding a file to `criticalFiles` therefore widens the mutation scope
as well — that is deliberate, and the reason the two live in one place.

The shards are packed by measured test time. Two cheaper proxies were tried and
both put a shard past its cap: file size is off by a factor of eighty across this
scope, and counting test executions still hid 25 % of the time in a shard
nominally carrying 20 %. Refresh the weights from the same report that sets the
baseline, priced with the suite's own durations:

```sh
npx vitest run --reporter=json --outputFile=test-results/vitest-durations.json
npx tsx scripts/mutation-shard-weights.ts --durations test-results/vitest-durations.json
```

Stale weights only unbalance the shards, and missing ones fall back to counting
executions. Neither changes the verdict, which is graded on the merged report.

#### Adding a file to `criticalFiles`

1. Add the file with its floors to `criticalFiles` in
   `quality/coverage-policy.json`. `stryker.config.js` reads that list, so the
   file is now in the nightly scope as well.
2. Add the same path to `scope` in `quality/mutation-policy.json`. The policy
   refuses a report whose configured or reported file set differs from it.
3. Push the branch and run the scheduled workflow against it:
   `gh workflow run deep-quality.yml --ref <branch>`. Its Critical Gates job
   runs the six shards and joins them. The baseline step fails; that is
   expected, the total has changed.
4. Download the joined report:
   `gh run download <run id> -n critical-mutation-report-<sha> -D test-results`
   gives `test-results/stryker-nightly.json`. Run `npm run test:mutation:policy`
   on the same commit; every `[regression]` and `[improvement]` line names a
   number to record.
5. Record `total`, `mutationScoreMinimum` (two decimals), `noCoverageMaximum`
   and `timeoutMaximum` from the report under `baseline`. `errorMaximum` and
   `ignoredMaximum` stay at zero.
6. Refresh the shard weights from the same report (the two commands above) and
   commit `quality/mutation-policy.json`, `quality/mutation-shard-weights.json`
   and the coverage policy together.

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
version with different bytes fails closed. A prerelease (`X.Y.Z-<label>.<n>`,
the shape Changesets pre mode produces) publishes under the dist-tag named by
its label — `2.0.0-beta.0` lands on `beta` — so `npm install` keeps resolving
`latest`; a version of any other shape is refused. The pipeline is ADR
[0013](architecture/0013-release-pipeline.md).

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

### Contracts that hold several things together

- `tests/unit/adapters/conformance.ts` — one behavioural suite for the four
  framework adapters (`adapterConformance(harness)`): injection on intent,
  CSP modes, the one-nonce rule, authorization refusal. A harness is only the
  framework-specific way to run a request; the per-adapter files keep what is
  genuinely framework-specific (SvelteKit chunks, sparse Nitro events, Astro
  prerender and loader mode).
- `tests/integration/wire-corpus.test.ts` — replays every capture under
  `tests/fixtures/wire-corpus/` through the real runtime. Record a new Payload
  version with `PLP_RECORD_CORPUS=1 npm run test:e2e:real-payload` after
  bumping `examples/payload-backend`; `npm run compat:check` then expects the
  version in `quality/compat-matrix.json`.
- `npm run test:treeshake`, `npm run test:edge`, `npm run test:bundle` — the
  built package as a consumer sees it: one-symbol bundles, a Web-platform-only
  runtime, and size budgets. All three run inside `npm run build`.
- `scripts/diagnostic-table.ts` · `npm run diagnostics:check` — the
  diagnostic-code table in `docs/troubleshooting.md` is rendered from
  `src/core/diagnostic-codes.ts`; the check fails on drift, on a code without
  a "what to do" entry and on an entry for a code that no longer exists.
  `npx tsx scripts/diagnostic-table.ts --write` re-renders it.
- `scripts/compat-table.ts` · `npm run compat:check` — the README
  compatibility table is rendered from `quality/compat-matrix.json`; the check
  fails when the table, a fixture lockfile or the CI workflow matrix disagree.
  `npm run compat:write` re-renders it. Every version in that table is one a
  fixture lockfile or a matrix job installs.

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

The Chromium update-to-paint trend runs the 300, 1,000 and 5,000-binding
scenario pages and measures one changed field per message from the Admin's
`postMessage` to the first animation frame after the bound element changed —
the earliest instant the new text can be on screen, not the compositor's own
timestamp. It reports p50/p95/max per scenario against the budget set for it
before 2.0 (p95 ≤ 100 ms) and keeps ninety days of reports as artifacts. It is a
trend: the only assertions are that every sample produced a measurement and
the page raised no errors, because timing on a shared runner is not a fact a
pull request should fail on. The same three scenario pages are functional E2E
in all three engines, where 5,000 bindings proves the visibility gate's replay
path rather than merely that 5,000 writes complete.

The deterministic CodSpeed benchmark harness is a hard workflow step, and its
timings are trend telemetry: the upload is allowed to fail unless the repository
variable `CODSPEED_REQUIRED=true` makes it fail closed, and a hard regression
gate would additionally need calibrated thresholds and the
`CodSpeed Performance Analysis` status required by the repository ruleset.
Absolute raw/gzip/Brotli package budgets and deterministic algorithmic
invariants are hard gates regardless.

## Protocol coverage, layered

What is proven about the Payload wire protocol, from the outside in:

1. **Full running-Payload E2E** (`tests/real-payload/`, `npm run test:e2e:real-payload`)
   boots an actual Payload 3.x admin — `examples/payload-backend`, a
   self-contained SQLite Payload + Next.js server, seeded and auto-logged-in —
   opens its real Live Preview panel, types into real form fields, and asserts
   that the cross-origin Astro preview iframe (the injected runtime) patches
   the DOM. No mock, no stub: real admin → real form → real `postMessage` →
   real iframe → runtime → DOM, driven by Payload's own admin code.
2. **Browser E2E** (`tests/e2e/`) drives a real browser and a real iframe
   across Chromium, Firefox and WebKit: `postMessage` → runtime → DOM. Its
   `/admin` page emulates the Payload admin, so it can exercise edge cases
   (XSS, origin spoofing, every field type) faster than booting a server.
3. **Wire corpus** (`tests/fixtures/wire-corpus/`, one file per Payload
   version, recorded from a real admin by `tests/real-payload/record-wire-corpus.spec.ts`
   with `PLP_RECORD_CORPUS=1`) is replayed through the real runtime by
   `tests/integration/wire-corpus.test.ts`: every capture must validate,
   render, and demonstrate exactly the capabilities the runtime then reports.
   `tests/integration/real-payload-protocol.test.ts` feeds a message captured
   verbatim from a Payload 3.85 admin through the real `MessageBus` and
   runtime, envelope quirks included: `collectionSlug` absent on a global,
   `externallyUpdatedRelationship: null`, `_status`/`id` alongside real fields.
4. **Weekly protocol watch** (`.github/workflows/protocol-watch.yml`) executes
   the real `@payloadcms/live-preview@latest` and `@canary` (Payload 4.0
   pre-releases) against the corpus and asserts that their behavior — the
   `ready` handshake, event discriminators, the `mergeData` REST request —
   still matches the runtime's invariants.

Tier 1 proves the real thing works end to end, tier 2 exhausts edge cases
quickly, tier 3 pins the exact wire shape Payload emits, and tier 4 catches
drift the moment Payload ships it. Per Payload version that means: 2.x is
covered by captured-message integration tests and `fieldSchemaJSON` typing;
3.85.0 by a corpus captured from a real admin; 3.88.0 by the real-admin E2E on
every push plus its corpus; `latest` and the 4.0 pre-releases by the weekly
watch, the latter as early warning only. The four real-app fixtures cover
Astro 7, Next.js 16, SvelteKit 2 and Nuxt 3 in all three engines; the Astro
4–7 peer range is wider than the single-major browser fixture and is backed
by the `astro-matrix` job.

## Tree-shaking gate

The root barrel tree-shakes, and that is measured rather than declared:
`npm run test:treeshake` bundles one-symbol consumers with Vite against the
built package, resolved through `node_modules` so `exports` and `sideEffects`
apply as after `npm install`, and holds each to a budget. Importing
`escapeHtml` from the root ships 220 B gzip, `lexicalToHtml` 4.3 KB,
`initLivePreview` 30.5 KB (the client with its built-in renderers, Lexical
included), `generateInlineScript` 24.8 KB (the inline runtime source and
nothing of the client). The focused entries give a bundler less to look
through; the bytes are the same. The table and its budgets are in
[benchmarks.md](benchmarks.md#tree-shaking-what-one-import-costs).

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
