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

The initial report baseline intentionally exposes 48 `ae-forgotten-export` findings
across seven legacy entry points. They are visible in the reports instead of being
removed from the snapshot, but API Extractor does not fail the 1.0.4 patch on them:
exporting or hiding those signature types can itself change the public surface. Package
maintainers own a type-surface cleanup review by 2026-11-13; no count increase is
acceptable in the meantime. Dual ESM/CommonJS declaration files are required to be
byte-identical by the exact-tarball gate, so one API report cannot hide condition drift.
