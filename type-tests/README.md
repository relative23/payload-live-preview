# Packed public type contracts

These fixtures are copied into temporary consumers only after `npm pack` has created
the exact archive under test. They intentionally do not resolve the repository source
tree.

- `*-positive.*.fixture` pins supported ESM and CommonJS usage.
- `*-negative.*.fixture` pins rejected usage with `@ts-expect-error`. If a declaration
  accidentally becomes permissive, TypeScript reports the now-unused directive and the
  package gate fails.
- Runtime fixtures install no optional peer. Codegen fixtures run in a separate consumer
  with the exact reviewed `ts-morph` peer.
- Both consumers use NodeNext, strict mode, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, and `skipLibCheck: false`.

Run the fail-closed package gate with `npm run test:package`. When a reviewed public API
change is intentional, regenerate all manifest-derived reports from the packed archive
with `npx tsx scripts/check-package.ts --update-api-reports`, review the report diffs,
then rerun the normal package gate.

The reports carry a reviewed number of `ae-forgotten-export` findings: types a public
signature references without the entry exporting them. That number is pinned as
`FORGOTTEN_EXPORT_BASELINE` in `scripts/api-contracts.ts`, whose comment records every
change to it and why each remaining finding is left visible rather than exported. The
gate fails on a change in either direction, so a new count is a reviewed edit of that
constant, not a mechanical update. Dual ESM/CommonJS declaration files are required to
be byte-identical by the exact-tarball gate, so one API report cannot hide condition
drift.
