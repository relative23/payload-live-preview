# ADR 0031 — Next.js 15.5 is supported because a job installs it

**Status:** Proposed • **Date:** 2026-10-17

Applies the rule of ADR 0009 to Next.js: a version in the README is a version a job installed.

## Context

2.0 supported Next.js 16 only. Next.js 15 was outside the claim for two reasons: no job ran it, and
a measurement on 2026-09-17 said it did not work. On 2.0.x, 30 of the 42 end-to-end cases against
`examples/nextjs-payload` failed on Next.js 15.5.25 with `Cannot find module 'react'`, because
`<LivePreviewScript />` loaded `react`, and the fragment endpoint `react` and `react-dom/server`,
through imports whose specifiers were computed at runtime, which Next.js 15's server bundle did
not resolve. That was this package's defect, not Next.js's. 2.1 imports them by literal specifier.

On 2026-10-17 the Next.js cases of the default suite (`next dev`, 72 cases), the webpack production
suite (54) and the base-path suite (63) passed on Next.js 15.5.25 in Chromium, Firefox and WebKit,
and the documented quickstart builds and serves. Only the reason for the exclusion was gone; the
other, that nothing would catch a regression, was not.

## Decision

1. Next.js 15.5 and 16 (App Router) are supported. Earlier 15 minors are not claimed: nothing ran
   on them.
2. The `next-matrix` job installs `next@^15` into the Next.js fixture on every push and runs, in
   Chromium, the Next.js cases of the default suite, the webpack production suite and the base-path
   suite. Those are the places where 15 and 16 differ: the dev and build bundler, the build flags
   and the base path. The fixture stays on 16 in three engines (`e2e`).
3. The package declares no `next` peer: Next.js is the host, and the adapter imports only `react`.
   The claim is the README row and this job, held together by `npm run compat:check`
   (`scripts/compat-matrix-jobs.ts` compares the majors the record lists with the majors the
   workflow installs, for Astro and for Next.js).
4. The production fixture passes the bundler flag per major (`scripts/next-build-arguments.mjs`).
   Next.js 16 builds with Turbopack unless told `--webpack`. Next.js 15 builds with webpack and does
   not know that flag.
5. A Turbopack production build on Next.js 15 (`next build --turbopack`) is not claimed: no suite runs it.
6. When Next.js stops patching 15, or the job turns red on something the adapter cannot fix, 15
   leaves the README row in the next minor, as an Astro major would (ADR 0009 §2).

## Consequences

- A claim for 15.5 without a job is no longer possible. A new Next.js 15 patch that breaks the
  adapter fails the push that first installs it, not a user's build.
- The job runs Chromium only; engine-specific behaviour is covered once, on 16.
- `^15` resolves to the newest 15.x. The README says 15.5 because that is the last minor of 15 at
  the time of writing; a 15.6 would be tested and claimed by the same row.
- The fixture's lockfile stays on 16; the install mutates the manifest in the CI checkout only.

## Alternatives considered

- **Keep 16 only.** Rejected: the failure that justified it was this package's and is fixed, and a
  user on 15 would have had no signal either way.
- **Run 15 nightly instead of on every push.** Rejected: the README table promises what each push
  ran. A nightly row is a different claim with a different table.
