# Testing and quality gates

This project treats tests as executable contracts, not as a test-count target. A
line is not considered protected merely because coverage reached it: critical
code also has mutation, generative, artifact, and real-browser checks appropriate
to its failure mode.

## Local commands

After `npm ci`, generate the inline runtime files once. Five of the six are
gitignored; `runtime-lean.generated.ts` is committed, and
[CONTRIBUTING](../CONTRIBUTING.md#the-single-source-runtime) says why and which
gate keeps it current:

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
5. Record `total`, `mutationScoreMinimum` (two decimals) and
   `noCoverageMaximum` from the report under `baseline`. `errorMaximum` and
   `ignoredMaximum` stay at zero. `timeoutMaximum` is a ceiling, not the
   report's count: it sits above the measured timeouts with room for a slow
   runner; fewer print a `[drift]` notice and only more fail. The score passes
   within `mutationScoreDriftMutants` mutants of the recorded value, and a
   `[drift]` line for it is a notice, not a number to record.
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
`latest`. A stable version is compared with the version the registry serves as
`latest`: a lower major publishes under `legacy`, so a 1.x security fix after
2.0.0 cannot take `latest` back, and a lower version in the same major is
refused. A version of any other shape is refused. The pipeline is ADR
[0013](architecture/0013-release-pipeline.md).

## Quality map

| Risk                                      | Primary evidence                                                                                                                                                                                                 | Lane                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Type/API compatibility                    | strict `tsc`, negative packed type fixtures, API Extractor reports                                                                                                                                               | pull request               |
| Package/module-resolution drift           | exact tgz, publint, ATTW, isolated ESM/CJS/NodeNext consumers                                                                                                                                                    | pull request               |
| Parser, trust-boundary, and race mistakes | fixed regressions, fast-check properties/models, critical mutation tests                                                                                                                                         | PR + main push + scheduled |
| Untested edits                            | critical per-file floors and changed-line LCOV gate                                                                                                                                                              | pull request               |
| Layer erosion and dead code               | source dependency graph, cycle rules, Knip                                                                                                                                                                       | pull request               |
| Browser/DOM differences                   | Playwright in Chromium, Firefox, WebKit and a real Payload application                                                                                                                                           | pull request               |
| Accessibility regressions                 | semantic live-region assertions and Axe WCAG A/AA scans                                                                                                                                                          | pull request               |
| Algorithmic or bundle regressions         | deterministic size/complexity gates and CodSpeed trends                                                                                                                                                          | PR + trend                 |
| Resource retention                        | exact handle counts, forced-GC Node leak gate, Chromium heap soak                                                                                                                                                | main push + scheduled      |
| Protocol ecosystem drift                  | captured real messages and pinned/latest/canary Payload watch                                                                                                                                                    | PR + scheduled             |
| Peer floors the hooks promise             | React 18.0.0, Vue 3.3.0 and Svelte 5.0.0 installed over the lockfile; hook, route-refresh and fragment suite (the SvelteKit one against a component compiled by `svelte/compiler` and the real `svelte/server`)s | pull request               |

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
- `tests/unit/core/morph-contract.test.ts`, `tests/unit/property/morph-keyed.property.test.ts`
  and the contract cases in `tests/e2e/specs/structural-morph.spec.ts` — the
  keyed morph's promises (ADR 0008 §8), one case each: what a retained node
  keeps, what pairs with what, what is never entered. The engine's mechanics
  stay in `tests/unit/core/morph.test.ts`.
- `tests/unit/security/xss-corpus.ts` with `sanitizer-corpus.test.ts` and
  `tests/unit/property/sanitizer-fuzz.property.test.ts` — the sanitizer's
  fence (ADR 0016): 118 vectors and an aimed fuzz under every policy, against
  an oracle that reads no allow-list and against DOMPurify as the reference
  engine (a devDependency). `npm run test:security-corpus` runs just these.
- `tests/integration/wire-corpus.test.ts` — replays every capture under
  `tests/fixtures/wire-corpus/` through the real runtime. Record a new Payload
  version with `PLP_RECORD_CORPUS=1 npm run test:e2e:real-payload` after
  bumping `examples/payload-backend`; `npm run compat:check` then expects the
  version in `quality/compat-matrix.json`.
- `npm run test:treeshake`, `npm run test:edge`, `npm run test:bundle` — the
  built package as a consumer sees it: one-symbol bundles, a Web-platform-only
  runtime, and size budgets. All three run inside `npm run build`.
- `scripts/check-interaction-budgets.ts` · `npm run test:interaction` — what one
  burst of typing costs: the merge requests an 18-keystroke burst makes, and the
  p95 from a keystroke to the change on the page, per scenario (plain text, rich
  text, relationship, an unbound field, a page with no bindings at all). The
  runtime is driven in jsdom against a merge endpoint that answers without delay,
  so both numbers are the package's own and reproduce run to run; the network
  half of what an editor waits for is carried by the request count instead. The
  limits and the reason for each of them are in `scripts/interaction-budgets.ts`.
  Request counts are exact rather than ceilings, and the latency rows carry a
  floor as well as a ceiling: an improvement nobody records fails the gate too.
  Runs inside `npm run build`.
- `tests/fixtures/protocol-model.ts` · `npm run test:protocol-semantics` — what
  each field on the wire _means_, and what the runtime must therefore do with
  it. Two halves. The form half is compared by the protocol watch against the
  message objects Payload's admin builds, read out of their source. The
  semantics half replays every wire corpus through the real runtime in jsdom and
  counts what the meaning implies: how many messages carry
  `externallyUpdatedRelationship`, how many distinct documents those name, how
  many `relationshipUpdate` events the runtime emits, and how many writes it
  still skips as unchanged after a save. Numbers are exact in both directions,
  and a row whose number is today a known defect carries the finding and the
  task that removes it. Runs inside `npm run build`.
- `tests/fixtures/delivery-budgets.ts` · part of `npm run test:e2e` — what an
  anonymous visitor is charged, per delivery path: how many `<script>` elements
  of a cookie-less response carry this package, and how many bytes those
  elements are once the runtime artifact inside them is discounted. The
  subtraction is what keeps the row a statement about the delivery: the
  runtime's own size is held by `INLINE_BUDGET`, and repeating it here would
  make every change to `src/` red in a test file. Both numbers are exact in both
  directions, so a path that stops charging fails until the win is recorded.
  `tests/e2e/specs/public-response.spec.ts` runs it against every fixture.
- `scripts/check-upstream-findings.ts` · `npm run test:upstream-findings` — the
  seven cases the comparison in `docs/react.md` is built from, re-run on the
  published `@payloadcms/live-preview` dist that the registry serves today. It
  packs the dist-tag, imports the real `dist/index.js` into a synthetic window
  and compares each observation against the one recorded when the comparison was
  written. Deliberately outside `npm run check` and `npm run build`: it needs the
  network and someone else's registry. It runs in the nightly protocol watch,
  where a red run usually means upstream fixed something and a row in
  `docs/react.md` has to go.
- `scripts/diagnostic-table.ts` · `npm run diagnostics:check` — the
  diagnostic-code table in `docs/troubleshooting.md` is rendered from
  `src/core/diagnostic-codes.ts`; the check fails on drift, on a code without
  a "what to do" entry and on an entry for a code that no longer exists.
  `npx tsx scripts/diagnostic-table.ts --write` re-renders it.
- `scripts/compare-scope.ts` — how much code this package spends on the job
  `@payloadcms/live-preview` also does, both sides measured as authored source
  (theirs recovered from the `sourcesContent` they ship). `--check` fails when
  our side moves without the reviewed number moving with it, so the ratio the
  comparison quotes stays a measurement rather than a memory.
- `scripts/check-complexity.ts` · part of `npm run test:architecture` — the
  reviewed size of the public surface: exported names per entry, adapter and
  inline options, diagnostic codes, source modules. The limits in
  [quality/complexity-budget.json](../quality/complexity-budget.json) are the
  exact current numbers with no headroom — a count is stable, so headroom would
  only be room to grow into without saying so. Raising one is two lines: the
  number, and why it moved. It is the byte budget's counterpart for the thing a
  reader pays instead of bandwidth.
- `scripts/check-trusted-core.ts` · part of `npm run test:architecture` — the
  eight modules a reader has to trust before handing the package a page, held
  at their measured line count and their reviewed imports from outside
  ([quality/trusted-core.json](../quality/trusted-core.json)). The capability
  rules beside it in `architecture-rules.ts` and `sink-rules.ts` say which
  module may listen, fetch, create the Trusted Types policy or write markup,
  and hold every sink site to [scripts/sink-inventory.ts](../scripts/sink-inventory.ts).
  What the core is and why is [docs/audit.md](audit.md).
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
the highest-risk pure boundaries on every pull request; the release-critical
profile, run on every push to `main` and on the schedule, expands to sanitizer,
origin, message ordering, scheduler, and plugin ownership. See
[mutation and property testing](testing/mutation-and-property-testing.md) for the
reproducible seeds, profiles, and baseline. A surviving mutant is not waived by
lowering a threshold: add a meaningful invariant, remove unreachable code, or
record a narrowly reviewed equivalent mutant — its position, mutator, original
and replacement text, and why the program does the same either way.

## Scheduled performance and leak gates

The deep-quality workflow runs 10,000 property cases per property, the expanded
mutation profile, and 10,000 fully awaited updates in a long-lived runtime under
forced GC, in addition to repeated start/destroy ownership churn. The mutation
shards, the trusted-core scope, the leak gate and the soak are one reusable
workflow, `critical-gates.yml`, which CI also calls on every push to `main` (the
Release Gates job, with the five-minute soak). The Node gate requires all owned
observers, listeners, timers, and DOM nodes to return to zero and both
long-session and post-destroy retained heap drift to remain below 2 MiB.

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
4. **Nightly protocol watch** (`.github/workflows/protocol-watch.yml`) executes
   the real `@payloadcms/live-preview@latest` and `@canary` (Payload 4.0
   pre-releases) against the corpus and asserts that their behavior — the
   `ready` handshake, event discriminators, the `mergeData` REST request —
   still matches the runtime's invariants. It also **reads their sender**: the
   published package is only the receiver, and the message object goes together
   in the admin UI, which ships compiled. A treeless fetch of
   `payloadcms/payload` and an AST walk over the two files that build and type
   that object are compared against `tests/fixtures/protocol-model.ts`. The
   second job of the same workflow points `examples/payload-backend` at each
   channel and runs the real admin E2E against it; `canary` is a major and may
   not boot, so that row is soft-fail like its wire-format twin. The same job
   re-runs `npm run test:upstream-findings`, so the comparison in
   `docs/react.md` is checked against the package a reader would install rather
   than against the version it was written for.

Tier 1 proves the real thing works end to end, tier 2 exhausts edge cases
quickly, tier 3 pins the exact wire shape Payload emits, and tier 4 catches
drift the moment Payload ships it. Per Payload version that means: 2.x is
covered by captured-message integration tests and `fieldSchemaJSON` typing;
3.85.0 and 3.88.0 by corpora captured from a real admin; 3.89.0 by the
real-admin E2E on every push plus its corpus; 4.0.0-canary.33 by a corpus
captured from a real Payload 4 admin in a one-off upgrade round (the fixture
stays on 3.x); `latest` and the 4.0 pre-releases by the nightly watch — wire
format, sender source and a real admin — the latter as early warning only. The
four real-app fixtures cover Astro 7, Next.js 16, SvelteKit 2 and Nuxt 3 in all
three engines; the Astro
4–7 peer range is wider than the single-major browser fixture and is backed
by the `astro-matrix` job.

## Tree-shaking gate

The root barrel tree-shakes, and that is measured rather than declared:
`npm run test:treeshake` bundles one-symbol consumers with Vite against the
built package, resolved through `node_modules` so `exports` and `sideEffects`
apply as after `npm install`, and holds each to a budget. Importing
`escapeHtml` from the root ships 210 B gzip, `lexicalToHtml` 5,043 B,
`initLivePreview` 44,601 B (the client with its built-in renderers, Lexical
included), `generateInlineScript` 42,223 B (the inline runtime source and
nothing of the client). The focused entries give a bundler less to look
through; the bytes barely move — `initLivePreview` from `./core` is 44,579 B,
`lexicalToHtml` from `./lexical` 5,175 B. The budgets are
`TREE_SHAKING_FIXTURES` in `scripts/check-tree-shaking.ts`; the first
measurement, and why the barrel did not tree-shake before it, are in
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
