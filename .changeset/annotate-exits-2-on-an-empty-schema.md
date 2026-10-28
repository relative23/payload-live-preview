---
'payload-live-preview': patch
---

`pll-codegen annotate` exits with `2` when the config yields no collection and no global, as `pll-codegen` does, and prints the extractor's warnings. It used to scan anyway, report every real field as one the schema does not have and exit `0`, so a config it could not open, or one that reaches its collections through a path alias, looked like templates with nothing to bind. A path alias still reads as empty there, because the subcommand takes no tsconfig; the message says so. Exit code `2` is new for this subcommand: a script that treated every non-zero exit other than `3` as a crash now sees it for a config it cannot read.
