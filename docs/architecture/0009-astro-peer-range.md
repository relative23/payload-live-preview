# ADR 0009 — The Astro peer range is what CI runs

**Status:** accepted, 2026-08-27. Supersedes the audit note under 1.4.0 that
recommended narrowing.

## Context

`peerDependencies.astro` says `>=4.0.0 <8.0.0`. Until this record, one
fixture (`examples/astro-payload`, Astro 7) stood behind that claim, and the
README said so in a sentence nobody could verify. The audit for 2.0 offered
two ways out: narrow the range to the one tested major, or add fixtures.

Running the existing fixture against Astro 6.4.8, 5.18.2 and 4.16.19 (the
latest of each major) settled which: the integration and the loader mode
build and serve on all three, and 26 of the 27 Astro-served browser tests
passed unchanged. The one failure was a real defect in this package, not
in the fixture — Astro 4–6 keep the source indentation between elements as
whitespace text nodes and Astro 7 compacts it, and the keyed morph moved a
retained `<input>` to step around that text, which blurs it (ADR 0008 §3
promised that focus survives). Fixed in the same change; the matrix is what
found it, which is the argument for having one.

## Decision

1. The range stays `>=4.0.0 <8.0.0` through 1.x.
2. Every major in the range runs in CI on every push: Astro 7 in Chromium,
   Firefox and WebKit through the E2E job, and Astro 4, 5 and 6 in Chromium
   through the `astro-matrix` job, which installs `astro@^N` into the same
   fixture and runs the Astro-served specs. A major that stops passing is
   removed from the range in the next minor, not silently kept.
3. The README compatibility table is rendered from `quality/compat-matrix.json`
   by `scripts/compat-table.ts`; `npm run compat:check` fails when the table,
   the fixture lockfiles and the workflow matrix disagree. A version in the
   table is a version a job installed.
4. 2.0 narrows the range to the majors the matrix still runs at release time
   (ADR 0007, ledger entry 12). Astro 4 is the likely first to go: it needs
   Vite 5 and its upstream support has ended; it stays as long as the job is
   green and cheap.

## Consequences

- A claim without a job is no longer possible for Astro, and the same
  mechanism covers Next.js, SvelteKit and Nuxt at their fixture versions.
- The matrix job costs about three minutes per major and runs Chromium
  only; engine-specific behaviour is covered once, on Astro 7.
- Installing another major into the fixture mutates its manifest in the CI
  checkout only; the committed lockfile stays on Astro 7.
