---
'payload-live-preview': patch
---

The release now installs the published package from the registry and imports
every subpath a Node consumer can reach, immediately after publishing.

Everything before this step reasons about the tarball the job built. This
proves the artifact the registry actually serves: installed by a plain
`npm install` into a directory with no workspace, no lockfile and no local
`dist` to fall back on. A release could be green end to end and still leave an
uninstallable package — a file missing from `files`, an export map resolving to
nothing, a dependency that only existed locally — and nothing would have
noticed.

The optional `ts-morph` peer is installed so the codegen entries are exercised
rather than failing on a missing package. Two subpaths are excluded by name and
reason: `RichText.astro` is compiled by Astro, `middleware-entry` imports a
virtual module. A subpath added to the package and not to that table fails the
check rather than going untested.
