---
'payload-live-preview': patch
---

Wait for npm to actually serve a freshly published version instead of failing the release on the first read.

npm acknowledges a publish before the new version is readable, and every read the release performs afterwards happened exactly once. All three 1.0.x releases published correctly and then went red: 1.0.5 and 1.1.0 could not observe the version at all, and 1.2.0 saw the metadata but got `ETARGET` when downloading the tarball. Each left the git tag and the GitHub release unmade until the job was re-run by hand.

Both post-publish reads now retry within a bounded budget — three minutes at five-second intervals — and the first attempt is never delayed, so a registry that is already consistent costs nothing. Only the shapes npm uses while propagating (`ETARGET`, `E404`, `notarget`) are retried; every other failure still fails immediately, so waiting can never mask a real fault.
