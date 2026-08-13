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

The PR profile is a hard 90% gate, with 90–95% shown as its improvement band. The
critical Nightly profile has a defensive native Stryker floor of 70%; the stricter
machine-readable report policy pins its exact reviewed score, scope, and terminal
status counts. A dry run alone cannot justify either ratchet.

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
document the exact mutant and why it is genuinely equivalent. Equivalent-mutant
records need an owner and a review date; they do not lower the threshold or exclude
an entire function/file.

## Initial PR baseline

The baseline is recorded from a clean default-profile run on the release candidate.
Update this section only with the exact report and runtime from that run; ordinary
coverage percentages are not a substitute for mutation evidence.

- Status: passing hard gate
- Scope: `src/security/csp.ts`, `src/security/url-validator.ts`,
  `src/core/field-value.ts`
- Uncached result (2026-08-13): 296 total, 278 killed, 18 survived, zero
  no-coverage, zero timeout, and zero error mutants; mutation score 93.92%.
- Final related-test run: 569 tests passed in 9 seconds. Complete uncached mutation
  run: 1 minute 43 seconds with four workers. A preceding run exposed a
  random-byte-dependent slash replacement survivor; deterministic `+` and `/`
  inputs now keep the exact 93.92% baseline repeatable.
- Threshold: 90% break, 90% low, 95% high. The break threshold leaves only a
  3.92-point calibration margin and therefore detects losing twelve currently
  killed mutants.

### Surviving-mutant review

No survivor is ignored by configuration. Seventeen are output-equivalent under the
current implementation and remain visible in every report:

- four field-path control-flow mutants duplicate the preceding direct lookup or the
  next iteration's null/type guard;
- seven CSP mutants alter an early-return/default/empty-token branch whose fallback
  serializes the same policy, or change an impossible zero whitespace index after
  leading ASCII whitespace has already been removed; and
- six URL mutants remove redundant empty/protocol-relative checks, a safe-URL guard
  implied by the following anchored patterns, or a regex repetition whose match is
  intentionally prefix-based.

One surviving CSP string mutant shortens the Web-Crypto remediation text while
retaining both the Node 18 and fail-closed security guidance. It is a diagnostic
fidelity gap rather than a security-behavior escape and is kept visible instead of
being excluded.

Owner: package maintainers. Review these classifications whenever one of the three
files changes, and no later than 2026-11-13. A refactor that removes equivalent
branches is preferable to accumulating ignore annotations.

## Critical Nightly baseline status

The superseded eight-file risk slice completed uncached in approximately 11 minutes
10 seconds: 1,811 total, 1,367 killed, 410 survived, 23 without coverage, 11 timed
out, and no error/ignored mutants (76.09% mutation score; 77.07% covered-code score).
It omitted files classified as critical by the repository coverage policy,
including current cache and observer bug-fix surfaces, so it is explicitly not a
critical-scope baseline.

The first aligned 14-file uncached run completed in 17 minutes 12 seconds after 918
related tests: 3,626 total, 2,578 killed, 900 survived, 136 without coverage, 11
timed out, one runtime error, and no ignored mutants (71.42% total; 74.20% covered
score). The sole error was Stryker's Vitest adapter failing to stringify the
exception from the mutant that removed the non-element guard at
`src/core/observers.ts:268`. A deterministic callback regression now kills all
three mutants in that exact range with zero errors in an 11-second targeted run.

After focused observer, sanitizer, and lifecycle hardening, the final uncached
14-file run passed its native 70% gate in 13 minutes 27 seconds after 950 related
tests: 3,623 total, 2,853 killed, 696 survived, 63 without coverage, 11 timed out,
zero errors, and zero ignored (79.05% total; 80.45% covered score).

`quality/mutation-policy.json` pins that exact file set, total, score, no-coverage,
timeout, error, and ignored baseline. Both regressions and improvements fail until a
maintainer consciously ratchets it. This makes scope reduction or a better score
visible review events rather than silently changing the quality contract.
