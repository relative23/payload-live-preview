---
'payload-live-preview': patch
---

Every release installs the published package from the registry and imports
every subpath a Node consumer can reach, immediately after publishing.

Everything before that step reasons about the tarball the release built. This
proves the artifact the registry serves: installed by a plain `npm install`
into a directory with no workspace, no lockfile and no local build to fall
back on, with the optional `ts-morph` peer present so the codegen and migrate
entries are exercised rather than failing on a missing package. A release
could otherwise be green end to end and still leave an uninstallable package —
a file missing from `files`, an export map resolving to nothing, a dependency
that only existed locally. A subpath added to the package and not to that
check fails the release rather than going untested.
