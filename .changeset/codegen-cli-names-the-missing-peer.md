---
'payload-live-preview': patch
---

`pll-codegen` names the missing optional peer instead of failing with a
module-resolution stack trace. `ts-morph` reads a Payload config, and nothing
else in the tool needs a TypeScript compiler, so it is now loaded on first use:
`pll-codegen --help`, `pll-codegen annotate --help` and a usage error all answer
without it, and a run that does need the schema exits 1 with
`pll-codegen needs ts-morph: npm install --save-dev ts-morph` — the sentence
`pll migrate` already printed for the same peer.
