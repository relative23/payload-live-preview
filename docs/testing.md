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
npx vitest run --reporter=default --reporter=json --reporter=./scripts/zero-skip-reporter.ts \
  --outputFile.json=test-results/vitest-durations.json
npx tsx scripts/mutation-shard-weights.ts --durations test-results/vitest-durations.json
```

Leading and trailing whitespace in full test names is removed as in Stryker's
Vitest reporter; whitespace inside a name stays meaningful. Assertions represented
by one Stryker ID contribute their combined duration. Distinct IDs with the same
file and normalized full name are refused.

Stale weights can unbalance the shards. Every file in the scope needs a positive
recorded weight for the unit gate. Stryker falls back to the source file size when
a weight is missing, but that fallback does not satisfy this gate. The
mutation-policy verdict is graded on the merged report.

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
   `noCoverageMaximum` from the report under `baseline`. `ignoredMaximum`
   stays at zero. `timeoutMaximum` and `errorMaximum` are ceilings, not the
   report's counts: the timeout ceiling sits above the measured timeouts with
   room for a slow runner, and the error ceiling holds the mutants that never
   end, which one runner records as a timeout and another as a crashed worker
   (the PR and core policies keep it at zero); fewer print a `[drift]` notice
   and only more fail. The score passes
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

| Risk                                      | Primary evidence                                                                                                                                                                                                | Lane                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Type/API compatibility                    | strict `tsc`, negative packed type fixtures, API Extractor reports                                                                                                                                              | pull request               |
| Package/module-resolution drift           | exact tgz, publint, ATTW, isolated ESM/CJS/NodeNext consumers                                                                                                                                                   | pull request               |
| Parser, trust-boundary, and race mistakes | fixed regressions, fast-check properties/models, critical mutation tests                                                                                                                                        | PR + main push + scheduled |
| Untested edits                            | critical per-file floors and changed-line LCOV gate                                                                                                                                                             | pull request               |
| Layer erosion and dead code               | source dependency graph, cycle rules, Knip                                                                                                                                                                      | pull request               |
| Browser/DOM differences                   | Playwright in Chromium, Firefox, WebKit and a real Payload application                                                                                                                                          | pull request               |
| Accessibility regressions                 | semantic live-region assertions and Axe WCAG A/AA scans                                                                                                                                                         | pull request               |
| Algorithmic or bundle regressions         | deterministic size/complexity gates and CodSpeed trends                                                                                                                                                         | PR + trend                 |
| Resource retention                        | exact handle counts, forced-GC Node leak gate, Chromium heap soak                                                                                                                                               | main push + scheduled      |
| Protocol ecosystem drift                  | captured real messages and pinned/latest/canary Payload watch                                                                                                                                                   | PR + scheduled             |
| Peer floors the hooks promise             | React 18.0.0, Vue 3.3.0 and Svelte 5.0.0 installed over the lockfile; hook, route-refresh and fragment suite (the SvelteKit one against a component compiled by `svelte/compiler` and the real `svelte/server`) | pull request               |
| Peer floors the Astro adapter promises    | the stored archive in reviewed locks: Astro 4.0.0 base adapter, 4.16.19 React islands, fragment rendering on 4.9.0 to 7.4.4; [details](#astro-peer-floors)                                                      | pull request               |

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
- `tests/unit/core/session-scope.test.ts` and `scripts/check-resource-inventory.ts`
  with `quality/resource-inventory.json` — the runtime session's contract (ADR
  0005, 2.1 note): after `destroy()`, `suspend()` or a failed start no timer,
  listener or observer is left, counted across fifty sessions; and every
  acquisition in `src/core` names who releases it, held against the source in
  the architecture gate.
- `tests/unit/security/xss-corpus.ts` with `sanitizer-corpus.test.ts` and
  `tests/unit/property/sanitizer-fuzz.property.test.ts` — the sanitizer's
  fence (ADR 0016): 143 vectors and an aimed fuzz under `strict`, `compat` and
  the item-template options against an oracle that reads no allow-list, and
  under `strict` and the item-template options against DOMPurify as the
  reference engine (a devDependency). `npm run test:security-corpus` runs just
  these.
- `tests/integration/wire-corpus.test.ts` — replays every capture under
  `tests/fixtures/wire-corpus/` through the real runtime. Record a new Payload
  version with `PLP_RECORD_CORPUS=1 npm run test:e2e:real-payload` after
  bumping `examples/payload-backend`; `npm run compat:check` then expects the
  version in `quality/compat-matrix.json`.
- `npm run test:treeshake`, `npm run test:edge`, `npm run test:bundle` — the
  built package as a consumer sees it: one-symbol bundles, a Web-platform-only
  runtime, and size budgets. All three run inside `npm run build`.
- `scripts/check-interaction-budgets.ts` · `npm run test:interaction` — what one
  burst of typing costs, in seven scenarios (plain text, rich text,
  relationship, an unbound field with and without a route strategy, a page with
  no bindings at all, an auto-bound page): the merge requests an 18-keystroke
  burst makes, the route refreshes on the page that has a route strategy, and,
  where the edit becomes visible (plain text, rich text, relationship, the
  auto-bound page), the p95 from a keystroke to the change on the page. The
  other rows pin requests and refreshes alone. The runtime is driven in jsdom
  against a merge endpoint that answers without delay, so the numbers are the
  package's own and reproduce run to run; the network half of what an editor
  waits for is carried by the request count instead. The limits and the reason
  for each of them are in `scripts/interaction-budgets.ts`. Request counts are
  exact rather than ceilings, and the latency rows carry a floor as well as a
  ceiling: an improvement nobody records fails the gate too. Runs inside
  `npm run build`.
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
- `scripts/check-upstream-findings.ts` · `npm run test:upstream-findings` — seven
  recorded observations of the base client, five of them the rows of the
  comparison in `docs/react.md`, re-run on the published
  `@payloadcms/live-preview` dist that the registry serves today. It
  packs the dist-tag, imports the real `dist/index.js` into a synthetic window
  and compares each observation against the one recorded when the comparison was
  written. Deliberately outside `npm run check` and `npm run build`: it needs the
  network and someone else's registry. It runs in the daily protocol watch,
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
  nine modules a reader has to trust before handing the package a page, held
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
  fixture lockfile or a matrix job installs. The same check reads every workflow
  job that installs a fixture lockfile (through `scripts/ci-install-fixture.sh`,
  `npm ci` or `npm install` with `--prefix`, or a Playwright helper listed in
  `scripts/compat-engines.ts`) and fails when a locked package's `engines.node`
  refuses the job's Node. A bare `node-version: 22` counts as 22.0.0.
  Each feature row of the matrix names the CI job that runs it. A Version PR
  records the CI run it releases (`npm run compat:record`, in the Release
  workflow): the run and its jobs go to `quality/compat-results.json`, and
  every row at an exact version becomes `passed` with that file's digest, the
  commit and the date. The check then fails when the file no longer has that
  digest. A row on a floating range stays `configured`, since nobody pinned
  the version it ran.

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
   self-contained SQLite Payload + Next.js server, seeded — opens its real Live
   Preview panel, types into real form fields, and asserts that the
   cross-origin preview iframe (the injected runtime) patches the DOM. No mock,
   no stub: real admin → real form → real `postMessage` → real iframe →
   runtime → DOM, driven by Payload's own admin code.
   `PLP_REAL_PAYLOAD_TARGET` picks the app the admin frames: the static Astro
   app (the default, with the seeded editor auto-logged-in), the SSR hybrid
   app, a plain HTML page, or the Next.js, SvelteKit, Nuxt and Astro
   middleware examples (Astro's built and served by Node; the Next.js one also
   as a React hook page, the Nuxt one as a Vue composable page), where the
   preview verifies the editor's session and the test signs in through the
   real login form. A further target frames the Next.js example from an admin
   that keeps `autoLogin`, which issues no cookie: the preview serves the
   public page and the admin keeps working. The `create` target gives the
   admin two collections, one routed by the plugin's function and one with a
   fixed string URL, and frames the SvelteKit example's pages for them: on the
   create screen neither has a preview toggle or frame, and after the first
   save the frame takes the editor's unsaved edits while REST reads show that
   the collection kept only the save. The `sveltekit3` and `sveltekit3-create`
   targets are the SvelteKit and `create` targets on the SvelteKit 3 example,
   `nuxt4` and `nuxt4-composable` the two Nuxt targets on the Nuxt 4 example.
   `nextjs-production`, `sveltekit-production`, `sveltekit3-production`, `nuxt-production` and `nuxt4-production` are the
   Next.js, SvelteKit and Nuxt session targets built for production and served
   behind TLS. Strict mode accepts only https admin origins there, so the admin
   is reached through an HTTPS front too, and the preview's server asks it who
   the editor is through that front, trusting its throw-away certificate.
   `findings` frames `examples/pure-html/dist/findings.html` from an admin with a
   global of its own, and shows that Payload's own messages carry what the field
   rules read: row ids after a move, an option's value, an edit in a block no
   renderer draws, and the save a route waits for.
   CI runs every target on every
   push: the Astro default in Chromium, the others in all three browsers, and
   the Next.js session target and its hook page once more in Chromium with
   Payload's CSRF list on. The other Next.js, SvelteKit and Nuxt targets run
   their development servers, and the admin itself runs `next dev`; the Astro,
   hybrid and HTML targets serve a build. The three browsers are Playwright's Chromium,
   Firefox and WebKit builds on Linux; Safari itself is not run. On a host that starts and stops containers while a
   dev-server target runs, Chromium can report `net::ERR_NETWORK_CHANGED` for
   the preview's module requests; the page then keeps its server render and a
   hook page stays `idle`. That is the host, not the package: it was seen on a
   shared workstation and not on the CI runners, and a local run with that
   line in the trace's console is repeated, not loosened.
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
4. **Daily protocol watch** (`.github/workflows/protocol-watch.yml`) executes
   the real `@payloadcms/live-preview@latest` and `@beta` (Payload 4.0
   pre-releases) against the corpus and asserts that their behavior — the
   `ready` handshake, event discriminators, the `mergeData` REST request —
   still matches the runtime's invariants. It also **reads their sender**: the
   published package is only the receiver, and the message object goes together
   in the admin UI, which ships compiled. A treeless fetch of
   `payloadcms/payload` and an AST walk over the two files that build and type
   that object are compared against `tests/fixtures/protocol-model.ts`. That
   first job ends by re-running `npm run test:upstream-findings`, so the
   comparison in `docs/react.md` is checked against the package a reader would
   install rather than against the version it was written for. The second job
   of the same workflow points `examples/payload-backend` at each channel and
   runs the real admin E2E against it; `beta` is a major and may not boot, so
   that row is soft-fail like its wire-format twin.
5. **Daily latest watch** (`.github/workflows/latest-watch.yml`) does the same
   for the frameworks. CI installs exact lockfiles, so this job installs Astro,
   Next.js, SvelteKit 3 and Nuxt 4 at their `latest` dist-tag, with the peers
   each release asks for, over the matching example without its lockfile. It
   then runs that framework's browser specs in Chromium and a real-admin smoke.
   A separate job runs the React, Vue and Svelte hook suites against `latest`.
   Those jobs run published install-time code, so they install with
   `--ignore-scripts`, keep no checkout credentials and may only read. Each
   leaves its result and `npm ls` as an artifact, and a report job that
   installs nothing files an issue per integration that failed
   (`scripts/report-latest-watch.ts`). A red run is news, not a release gate.
   Every entry runs a second time on a pre-release channel, which
   `scripts/prerelease-channel.ts` picks: one of `alpha`, `beta`, `rc`,
   `canary` and `next` whose version is above `latest`, and of those the one
   published last. A canary of a version already released, a channel that
   stopped and an internal tag are therefore never installed, and an entry
   with no such channel stops after asking. Those entries may fail without
   failing the run, and they share one pinned issue.

Tier 1 proves the real thing works end to end, tier 2 exhausts edge cases
quickly, tier 3 pins the exact wire shape Payload emits, tier 4 catches
drift the moment Payload ships it, and tier 5 does the same for a framework
release. Per Payload version that means: 2.x is
covered by a corpus captured from a real 2.32.3 admin, captured-message
integration tests and `fieldSchemaJSON` typing;
3.85.0, 3.88.0 and 3.89.0 by corpora captured from a real admin; 3.92.1 by the
real-admin E2E on every push; 4.0.0-beta.4 and beta.6 by corpora captured from
a real Payload 4 admin (the fixture stays on 3.x) and by one measurement of the config
plugin against a real admin, outside CI ([compatibility list](../README.md#compatibility)); `latest`
and the 4.0 pre-releases by the daily watch — wire format, sender source and
a real admin — the latter as early warning only. The
four real-app fixtures cover Astro 7, Next.js 16, SvelteKit 2 and Nuxt 3 in all
three engines; the Astro
4–7 peer range is wider than the single-major browser fixture and is backed
by the `astro-matrix` job, and Next.js 15.5 by the `next-matrix` job, which
installs it over the Next.js fixture and runs the development, webpack
production and base-path suites in Chromium. SvelteKit 3 has a fixture of its
own, `examples/sveltekit3-payload`, the SvelteKit example migrated with
`npx sv migrate sveltekit-3`; the `sveltekit3` job runs its SvelteKit specs
in all three engines. Nuxt 4 has one too, `examples/nuxt4-payload`, the Nuxt
example in Nuxt 4's `app/` layout, and the `nuxt4` job runs its Nuxt specs in
all three engines.

## Local release checks

Checks run by hand on the package archive of a release, on this machine and apart from CI.

### 2.1.0 (2026-10-23)

The following checks passed on 2026-10-23 on the package archive that was published as 2.1.0; the npm tarball differs from it only in the build timestamp. These are local results, separate from the CI jobs. Browser counts include Chromium, Firefox and WebKit on Linux. `examples/payload-version-lanes` runs the Payload 2.32.3 rows, with `--probe=population`, `--probe=lifecycle` or `--probe=guards` for React and Vue.

| Version        | Checked population                                                                                                                                                                                                  | Passed cases                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Payload 2.32.3 | DOM, React and Vue, each with frontend-only and serverURL modes                                                                                                                                                     | 24 per variant, six variants  |
| Payload 2.32.3 | React and Vue hook lifecycle, frontend-only and serverURL                                                                                                                                                           | 9 per variant, four variants  |
| Payload 2.32.3 | React and Vue hook guards, frontend-only and serverURL                                                                                                                                                              | 21 per variant, four variants |
| Node 20.19.0   | Peer-free consumer of the archive: every export without a peer under ESM and CommonJS, CLI help, inline script, signed tokens, `payload-session` and the fragment endpoint with its body, deadline and depth limits | 11 runtime cases              |
| Next.js 16.4.2 | Webpack production preview and fragment rendering                                                                                                                                                                   | 54 browser cases              |
| Astro 4.0.0    | Base adapter with loader and inline delivery, static output and scoped updates, two control builds                                                                                                                  | 36 browser cases              |
| Astro 4.16.19  | Native React islands, CSP and navigation ownership                                                                                                                                                                  | 12 browser cases              |

The Node row runs the official 20.19.0 binary with no framework or optional peer installed; its fragment endpoint uses a custom renderer and its session check a local `/me` stub, not a real Payload admin, and it covers no framework build, development server or browser. The Next checks use a controlled preview cookie and fragment tokens; they do not use a real Payload admin. The Payload 2 graph still has upstream audit findings, including a critical finding in the 2026-10-05 audit. Its passing preview cases establish compatibility, not a clean dependency graph. Payload 3 lifecycle and Payload 4 canary checks are not included in this table. The Payload 2 lifecycle and guards rows run development builds on Linux engines. The lifecycle row covers an owner replaced while a read is held, a document change by navigation and a reload of the preview frame. The guards row covers a late successful response of a replaced owner, messages from a foreign window and a foreign origin, a receiver switch in a running session and a sign-out in the middle of one; neither row covers a token that expires by time or a production build.

The two Astro rows can be repeated from the repository. The `astro-floor-base` and `astro-floor-islands` jobs run their specs on every push in Chromium ([Astro peer floors](#astro-peer-floors)); the counts above are all three engines, with loader and inline delivery at five cases each and two control builds per engine for Astro 4.0.0.

## Astro peer floors

`astro@^4` installs the newest 4.x, so the `astro-matrix` job cannot say what the lower
bound of the peer range does. Three more jobs run on every push, in Chromium. Each installs
the archive the Build job stored (`release-candidate-<sha>`, the bytes the Release workflow
publishes) into a consumer of its own, whose lockfile was reviewed once and is installed as
it stands, not resolved at run time:

- `astro-floor-base` — Astro 4.0.0, the lower bound of `peerDependencies.astro`
  ([lock](../tests/fixtures/astro-floor-base-deps/package-lock.json),
  [spec](../tests/e2e/continuation/astro-floor-base.spec.ts)). A static page with the
  shipped `RichText.astro` and `PreviewBoundary.astro` is built with `livePreview()` in
  `loader` and in `inline` delivery and framed by a mock parent that posts the observed
  Payload message shape: the public page stays inactive, the runtime starts in the frame, a
  title update arrives as plain text, the empty boundary fills and empties, and a second
  document is ignored. A `.astro` template that transpiles but does not type-check must be
  rejected (TS2551) before the clean build. Two control builds change one thing each — no
  integration, and an `allowedOrigins` that does not name the parent, with the localhost
  shortcut off — and the same assertions must fail on them, or a pass could come from the
  static page alone.
- `astro-floor-islands` — Astro 4.16.19 with `@astrojs/react` 3.6.3 and React 18.3.1
  ([lock](../tests/fixtures/astro-react-versions/4.16.19/package-lock.json),
  [spec](../tests/e2e/continuation/astro-islands.spec.ts)), the first Astro whose container
  takes `resolve` (ADR 0021). The four cases of the island contract run under the
  build-hash CSP: consecutive unsaved revisions keep the island's state, the page control
  hydrates, unlisted inline script and style stay blocked, and soft navigation unmounts it.
- `astro-fragment-versions` — fragment rendering and page-owned resources (ADR 0020) on
  Astro 4.9.0, 4.16.19, 5.18.2, 6.4.8, 7.3.2 and 7.4.4, one matrix entry each with a lock of its own
  ([4.9.0 lock](../tests/fixtures/astro-resource-versions/4.9.0/package-lock.json),
  [spec](../tests/e2e/continuation/astro-resources.spec.ts)). 4.9.0 is the Container API
  floor: its container takes no props, so the packed default renders the catalog there, and the
  verified-context case, which needs the application's own renderer, is left out of that version
  by the Playwright scope. The other five versions run it too.

To run them yourself, build and pack once, then point them at the archive. The first install
needs the registry; later ones use the npm cache. Without `--project=chromium` all three
engines run, one after the other:

```sh
npm run build
npm run test:package -- --artifact-dir /tmp/release-artifact --source-commit "$(git rev-parse HEAD)"
export PLP_CONTINUATION_TARBALL=/tmp/release-artifact/payload-live-preview-<version>.tgz
npx playwright test --config playwright.astro-floor-base.config.ts                                   # port 4290
PLP_ASTRO_RESOURCE_VERSION=4.16.19 npx playwright test --config playwright.astro-islands.config.ts   # port 4287
PLP_ASTRO_RESOURCE_VERSION=4.9.0 npx playwright test --config playwright.astro-resources.config.ts   # port 4287
npx playwright test --config playwright.astro-owner.config.ts                                       # port 4287, Astro 7.3.2, page-owned React
```

What they do not show. The parent is a mock, so neither is a real-admin result. The island
lane measures `client:load` only. The locks are the exact versions themselves, so
`npm audit --package-lock-only` reports the advisories of those versions (counted on
2026-10-24: one critical and four high for the Astro 4.0.0 lock, one critical and five high for
the Astro 4.16.19 React lock). Only the tests install them, in a temporary directory outside the
repository; the base lane serves a static build and the other lanes a Node server on loopback
behind a throw-away TLS proxy. `fixture-audit` covers `examples/`, not these locks.

## Production hosts

The `production-lifecycle` job builds a Next.js, a SvelteKit, a Nuxt, a plain HTML, a
standalone Vue and a standalone React host for production, one matrix entry each, in Chromium
([spec](../tests/e2e/continuation/next-host.spec.ts)). Each host is an application of its own
([Next.js](../tests/fixtures/next-continuation/), and the same for the others) on the
dependencies a reviewed lock pins: the matching example's, and for Vue and React
[`tests/fixtures/vue-host-deps`](../tests/fixtures/vue-host-deps/package-lock.json) and
[`tests/fixtures/react-host-deps`](../tests/fixtures/react-host-deps/package-lock.json). The
archive the Build job stored stands in place of the package, and the host is served behind a
throw-away TLS proxy. Beside it runs Payload 3.92.1 on SQLite
([lock](../tests/fixtures/payload-acl/package-lock.json)): two editors sign in there, and its
access control decides what each one may read. The seven cases:

- unsaved related drafts render, local state stays, and the preview survives native
  navigation and a reload;
- two logins and two locale tabs stay apart, including relationships one editor may not
  read, and recover;
- concurrent server renders and data reads stay bound to their user and locale;
- anonymous, foreign-target, replayed and logged-out requests are refused before any
  private read;
- the last good DOM survives a network failure, late data from an old revision is
  rejected, and an expired grant is refused;
- preview responses carry private cache headers, and public HTML carries no draft data
  and no preview script;
- a missing browser cookie is not replaced by a query or header.

The HTML, Vue and React hosts run one case more each. The HTML one removes a preview owner while
its request is in flight and mounts it again: the late response is dropped, and a title with
markup stays text ([spec](../tests/e2e/continuation/html-owner.spec.ts)). The Vue one disposes of the
composable's scope mid-request, ignores the messages that arrive after it and mounts exactly
one replacement ([spec](../tests/e2e/continuation/vue-owner.spec.ts)). The React one does the same by
unmounting the component that calls the hook
([spec](../tests/e2e/continuation/react-owner.spec.ts)).

To run them yourself, build and pack as above, then:

```sh
npx playwright test --config playwright.next-continuation.config.ts --project=chromium       # port 4284
npx playwright test --config playwright.sveltekit-continuation.config.ts --project=chromium  # port 4285
npx playwright test --config playwright.nuxt-continuation.config.ts --project=chromium       # port 4286
npx playwright test --config playwright.html-continuation.config.ts --project=chromium       # port 4288
npx playwright test --config playwright.vue-continuation.config.ts --project=chromium        # port 4289
npx playwright test --config playwright.react-continuation.config.ts --project=chromium      # port 4291
```

What they do not show. The test posts the editor's messages itself, so Payload's admin UI
is not part of it; the `real-payload-surfaces` targets drive the admin UI, against the
development servers and, for the three `-production` targets, against production builds.
The locked versions are those of the SvelteKit 2 and Nuxt 3 examples,
and the Vue and React hosts run the versions their locks pin, 3.5.41 and 19.3.1, not the peer
floors 3.3 and 18. The job runs Chromium only.

## Tree-shaking gate

The root barrel tree-shakes, and that is measured rather than declared:
`npm run test:treeshake` bundles one-symbol consumers with Vite against the
built package, resolved through `node_modules` so `exports` and `sideEffects`
apply as after `npm install`, and holds each to a gzip budget. Importing
`escapeHtml` from the root is held to 214 B, `lexicalToHtml` to 5,701 B,
`initLivePreview` to 55,745 B (the client with its built-in renderers, Lexical
included), `generateInlineScript` to 53,382 B (the inline runtime source and
nothing of the client). The focused entries give a bundler less to look
through; the bytes barely move — `initLivePreview` from `./core` is held to
55,726 B, `lexicalToHtml` from `./lexical` to 5,840 B. The budgets are
`TREE_SHAKING_FIXTURES` in `scripts/tree-shaking-budgets.ts`, with the reason
each one moved; the first measurement, and why the barrel did not tree-shake
before it, are in
[benchmarks.md](benchmarks.md#tree-shaking--what-one-import-costs).

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
