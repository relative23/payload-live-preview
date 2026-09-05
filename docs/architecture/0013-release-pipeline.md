# ADR 0013 — Release pipeline

**Status:** Accepted • **Date:** 2026-09-04

## Context

A release used to be whatever `npm publish` packed on the machine that ran it.
That machine's Node, npm, clock and working tree shaped the archive, and
nothing tied the published bytes to a CI verdict. The pipeline below existed
in workflow comments and script headers before this record; this is the record.

## Decision

### 1. CI certifies one artifact; the release publishes that artifact

The Build job (`build.yml`) builds once with `SOURCE_DATE_EPOCH` derived from
the tested commit, runs `npm run test:package -- --artifact-dir release-artifact
--source-commit <sha>`, and uploads the tgz with `package-artifact.json` as
`release-candidate-<sha>`. The manifest binds package identity, commit, source
epoch, Node and npm versions, SHA-1/256/512 integrity, sizes and the complete
path/size/mode inventory. The release never packs a checkout: it downloads
exactly that artifact by run id and name, reruns the package gate with
`--tarball`, and hands the same bytes to `npm publish --ignore-scripts
--provenance` (`scripts/publish-artifact.ts`).

### 2. The gate decides; the workflow only carries the decision

`scripts/release-gate.ts` runs after every completed CI run and on
`workflow_dispatch` with a `run_id`. It accepts only a completed, successful CI
`push` run on `main` of this repository whose head is an ancestor of
`origin/main`, reads `package.json` at that commit, and asks the registry:

- the version is not on npm → **publish**;
- it is, and `.changeset/` holds changesets → **Version PR**
  (`changesets/action` runs `npm run version`, title `chore: release`);
- it is, no changesets, no GitHub Release yet → **publish**, which reconciles (§3);
- the GitHub Release exists → nothing; a tag on another commit → an error.

The Version PR job additionally requires the tested commit to still be the tip
of `main`, because `changesets/action` branches from `github.sha`. The publish
job does not: a newer push must not block an artifact the gate has proven.

### 3. Publish is byte-identical and reconciles rather than repeats

Before publishing, the script reads `dist.integrity` from the registry. Missing
→ publish. Present with the certified integrity → **reconcile**: skip the
publish and continue with verification, tag and release, so a rerun after a
failure between publish and tag finishes the release instead of stopping on
"already published". Present with a different integrity → fail closed; the
registry holds bytes nobody certified. After a publish the script waits for the
registry to serve the version, downloads the served tgz and compares its
digests and inventory with the CI manifest. Only then is the `v<version>` tag
created; `scripts/github-release.ts` pushes it and creates the GitHub Release
from the CHANGELOG section, reconciling in the same way — a tag or release
already on the tested commit is accepted, one on another commit is an error.

### 4. Prereleases publish under their label

The dist-tag is derived from the version and nothing else: `X.Y.Z` → `latest`;
`X.Y.Z-<label>.<n>`, the shape Changesets pre mode produces → `<label>`, so
`2.0.0-beta.0` lands on `beta` and `npm install` keeps resolving the stable
release. A version of any other shape is refused. The GitHub Release is marked
prerelease when the version carries a hyphen.

### 5. Versions are bumped by the script, never by hand

`npm run version` runs `changeset version` and then
`scripts/sync-lockfile-metadata.ts`, which copies the new name and version into
the root lockfile and the four `file:../..` fixture lockfiles. The package gate
rejects a lockfile whose identity lags `package.json`, so a manual `npm version`
cannot reach npm.

## Consequences

- What is on npm is what CI tested, provably: manifest and registry archive are
  compared on every release, and the publish job pins the exact npm the
  manifest names.
- A missed release — a newer push landed while its CI ran — is re-entered with
  `workflow_dispatch` and the CI run id; the gate logic is today's, the
  artifact is the certified one.
- Nothing is published from a laptop, so there is no publish token to leak
  from one; the workflow uses OIDC provenance.
- After a merge to `main`, the Version PR is the one manual step: review the
  CHANGELOG entry and merge it. `npm run test:smoke` then installs the
  published package from the registry; it cannot prevent a broken publish,
  only make it loud.
