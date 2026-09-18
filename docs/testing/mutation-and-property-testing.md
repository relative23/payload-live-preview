# Mutation and property testing

The ordinary unit suite includes bounded, deterministic fast-check properties for
the security and lifecycle boundaries. Each assertion uses a fixed seed and
fast-check reports the shrink path for every failure, so a counterexample can be
replayed without relying on CI timing.

Run the PR-sized properties with the normal unit suite. Increase exploration for a
scheduled run without maintaining a second corpus:

```sh
PLP_PROPERTY_SEED=20260814 PLP_PROPERTY_RUNS=1000 npx vitest run tests/unit/property
```

PR tests use stable per-property seeds. The scheduled job rotates
`PLP_PROPERTY_SEED` from its recorded workflow run ID and prints it before testing.
Reusing it locally generates the same case stream, while the seed and shrink path
in a fast-check failure identify the exact counterexample.

The properties cover CSP parsing and merge fixed points, URL/origin policy, safe
dotted data paths, sanitizer fixed points and sink invariants, MessageBus guards and
ordered async token outcomes, plus model-based state machines for MessageBus
attachments, scheduler revision ownership, and plugin resource ownership.
The final scheduled profile completes all 26 tests at 10,000 runs per property in
5.54 seconds on the maintainer baseline machine, including its contract for
replayable environment overrides.

## Stryker profiles

The default profile is intentionally bounded for pull requests. It mutates the CSP,
URL, and prototype-safe field-path boundaries and selects their related Vitest tests:

```sh
npx stryker run stryker.config.js
```

The scheduled profile covers every file classified as critical by
`quality/coverage-policy.json`, plus the PR-only field-path boundary and the shared
A11y lease. Reading the central policy at startup prevents coverage and mutation
risk classifications from drifting apart:

```sh
STRYKER_SCOPE=nightly npx stryker run stryker.config.js
```

The core profile mutates the trusted core alone — the eight modules
`quality/trusted-core.json` names, read from that file so the two lists cannot
drift — because the figure the audit page quotes has to be the core's own
and not the average of sixty files. Its target is every mutant
killed; `quality/mutation-policy-core.json` holds the measured score, and its
`equivalent` list names every survivor that is left, one entry each: the file,
line and column, the mutator, the text it replaced and what it put there, and
one sentence saying why the program does the same with and without it. The
policy holds the list in both directions — a survivor the list does not name
fails the run, and so does an entry whose mutant is killed now (a ratchet to
take), moved, or described with other text — so the score below 100 is not a
gap but a reviewed remainder, and the survivors stay visible in every report.
It runs on every push to `main`, in the Critical Gates workflow beside the six
nightly shards: about 40 minutes against their 150-minute cap, so it costs
runner minutes and no wall clock. The nightly report cannot stand in for it —
that one is a single score over sixty-odd files, while this one asks 99.18 % of
eight and names every survivor. 2.0.3 is what the gate is for: a registry name
moved onto the realm, no test held it, and only the core run said so.

Its timeout ceiling is 25 against 10 measured here, for the same reason the
nightly one is 60 against 23: a loaded runner turns mutants the tests kill
outright into timeouts, which count as detected and leave the score alone. The
score minimum and the `equivalent` list stay exact.

By hand, on the same scope:

```sh
STRYKER_SCOPE=core npx stryker run stryker.config.js
npm run test:mutation:policy:core
```

The PR profile is a hard 90% gate, with 90–95% shown as its improvement band. The
critical Nightly profile has a defensive native Stryker floor of 70%; the stricter
machine-readable report policy pins its exact scope and total, its reviewed score
within a drift band, and its terminal status counts. A dry run alone cannot
justify either ratchet.

Validate the generated reports explicitly after Stryker:

```sh
npm run test:mutation:policy:pr
npm run test:mutation:policy
```

Both profiles use per-test coverage selection and write their machine-readable and
HTML reports under the ignored `test-results/` directory. CI and baseline runs do
not use cached results. Local repeat runs can opt in explicitly with
`STRYKER_INCREMENTAL=1`; threshold values are calibrated from an uncached baseline.

There are no blanket mutant exclusions. A surviving mutant must be handled in one of
three ways: add an invariant that kills it, remove unreachable production code, or
document the exact mutant and why it is genuinely equivalent. An equivalent-mutant
record in a policy's `equivalent` list names the file, line and column, the
mutator, the original and replacement text, and one sentence on why; it does not
lower the threshold or exclude an entire function/file.

## Initial PR baseline

The baseline is recorded from a clean default-profile run on the release candidate.
Update this section only with the exact report and runtime from that run; ordinary
coverage percentages are not a substitute for mutation evidence.

- Status: passing hard gate
- Scope: `src/security/csp.ts`, `src/security/url-validator.ts`,
  `src/core/field-value.ts`
- Current baseline (`quality/mutation-policy-pr.json`, the file that decides):
  361 total, mutation score 93.63%, zero no-coverage, error and ignored mutants,
  a timeout ceiling of 2 and a score drift band of 2 mutants.
- Initial uncached result (2026-08-13): 296 total, 278 killed, 18 survived, zero
  no-coverage, zero timeout, and zero error mutants; mutation score 93.92%.
- Final related-test run of that baseline: 569 tests passed in 9 seconds.
  Complete uncached mutation run: 1 minute 43 seconds with four workers. A
  preceding run exposed a random-byte-dependent slash replacement survivor;
  deterministic `+` and `/` inputs made the 93.92% result repeatable.
- Threshold: 90% break, 90% low, 95% high. Against 93.63% of 361 mutants the
  break threshold is crossed after fourteen detected mutants are lost; the report
  policy fails first, on the third, because it allows a drift of two.

### Surviving-mutant review

No survivor is ignored by configuration. The review below classifies fourteen
survivors — thirteen output-equivalent and one diagnostic-text mutant — and was
last revised on 2026-09-11. The current baseline implies 23 survivors (361
mutants at 93.63%, none uncovered); `quality/mutation-policy-pr.json` declares no
`equivalent` list, so the survivors are held by the score alone and the ones not
named here are not classified on this page. All remain visible in every report:

- four field-path control-flow mutants duplicate the preceding direct lookup or the
  next iteration's null/type guard;
- seven CSP mutants alter an early-return/default/empty-token branch whose fallback
  serializes the same policy, or change an impossible zero whitespace index after
  leading ASCII whitespace has already been removed; and
- two URL mutants (since 2026-09-11, six before): the empty check after trimming,
  which the URL parse and the relative-path pattern refuse anyway, and a regex
  repetition whose match is intentionally prefix-based. The other four — the empty
  check before trimming and the safe-URL guard the external-URL patterns imply —
  were lines the trusted-core mutation run showed no test could reach, and are gone.

One surviving CSP string mutant shortens the Web-Crypto remediation text while
retaining both the Node 18 and fail-closed security guidance. It is a diagnostic
fidelity gap rather than a security-behavior escape and is kept visible instead of
being excluded.

Owner: package maintainers. Review these classifications whenever one of the three
files changes, and no later than 2026-11-13. A refactor that removes equivalent
branches is preferable to accumulating ignore annotations.

## Critical Nightly baseline

The reviewed baseline is `quality/mutation-policy.json`: the exact file scope,
the mutant total, the minimum score, and the no-coverage, timeout, error and
ignored maxima. `npm run test:mutation:policy` fails on a regression and on an
improvement alike until a maintainer ratchets the file, so a scope reduction and
a better score are both visible review events rather than silent changes to the
quality contract. Two numbers are not exact: the score passes within
`mutationScoreDriftMutants` mutants of the recorded minimum, and
`timeoutMaximum` is a ceiling — more timeouts fail, fewer print a notice.
Earlier baselines — an eight-file slice, then fourteen files — are in this
file's Git history; their numbers describe a scope that no longer exists.

The scope is the union `stryker.config.js` builds: every `criticalFiles` entry of
`quality/coverage-policy.json`, the three PR-profile files and `src/core/a11y.ts`.
How the baseline is refreshed when a file joins that set is the numbered
procedure under "Adding a file to `criticalFiles`" in
[docs/testing.md](../testing.md).
