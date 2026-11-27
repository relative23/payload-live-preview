---
'payload-live-preview': major
---

`payload-live-preview/doctor` and `payload-live-preview/migrate` are no longer importable (ADR 0007, row 42). They exposed the `pll` binary's own modules as libraries (`runDoctor()`, `analyzeProbe()`, `migrateSource()`). The binary stays as it is: `pll doctor <url> --json` prints the findings for a script to read, and `pll migrate <path>` runs the codemods. `pll doctor --v3` names a call from either entry.
