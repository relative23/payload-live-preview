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
`push` run of this repository on a release branch — `main`, `release/1.x` or `release/2.0`,
listed once as `RELEASE_BRANCHES` — whose head is an ancestor of that branch on
`origin`, reads `package.json` at that commit, and asks the registry:

- the version is not on npm → **publish**;
- it is, and `.changeset/` holds changesets → **Version PR**
  (`changesets/action` runs `npm run version`, title `chore: release`);
- it is, no changesets, no GitHub Release yet → **publish**, which reconciles (§3);
- the GitHub Release exists → nothing; a tag on another commit → an error.

The Version PR job additionally requires the tested commit to still be the tip
of `main`, because `changesets/action` branches from `github.sha`. Under
`workflow_run` that is always the tip of `main`, and a step cannot change it:
the runner writes `GITHUB_SHA` from the `github` context over any step `env`.
A maintenance branch therefore gets no Version PR — with changesets there and
its version already on npm, the gate fails and names the hand step (§7–8). The
publish job does not require the tip: a newer push must not block an artifact
the gate has proven.

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

### 4. The dist-tag follows the version and the registry's `latest`

npm moves a dist-tag to whatever is published under it, so the tag decides what
`npm install payload-live-preview` resolves. `distTagForVersion()` in
`scripts/release-version.ts` takes the version and the version the registry
serves as `latest`:

- `X.Y.Z-<label>.<n>`, the shape Changesets pre mode produces → `<label>`, so
  `2.0.0-beta.0` lands on `beta` and installs keep resolving the stable release;
- a stable version whose major is below the major of `latest` → `legacy`, so a
  1.x security fix published after 2.0.0 cannot take `latest` back (§7);
- a stable version below `latest` in the same major → refused, it would move
  `latest` backwards;
- any other stable version → `latest`, and so does the first publish of a
  package that has no `latest` yet.

A version of any other shape is refused. `latest` is read once, before anything
is published (`registryLatestFrom()`), and not retried: it is not the
read-after-write delay the wait in §3 exists for, npm retries transient network
failures itself, and a run that stops there has changed nothing. The publisher
hands its tag to the next step as the `dist_tag` output; `scripts/github-release.ts`
marks the GitHub Release prerelease when the version carries a hyphen and passes
`--latest=false` whenever the tag is not `latest`, so GitHub's Latest label
follows npm's.

### 5. Versions are bumped by the script, never by hand

`npm run version` runs `changeset version` and then
`scripts/sync-lockfile-metadata.ts`, which copies the new name and version into
the root lockfile and the four `file:../..` fixture lockfiles. The package gate
rejects a lockfile whose identity lags `package.json`, so a manual `npm version`
cannot reach npm.

### 6. The first release candidate freezes the scope (added 2026-09-11)

From the first `v2.0.0-rc.*` tag until `2.0.0` is on npm, the branch takes
fixes and nothing else:

- Changesets are `patch`. A `minor` or `major` changeset is scope, and scope
  waits for the next minor.
- No new option. `PreviewAdapterOptions` and `InlineScriptConfig` keep their
  member counts, and with the second so does `INLINE_CONFIG_KEYS`: every wire
  key is a member of that interface (`satisfies` holds it), so a new slot cannot
  appear without a new member.
- No new public declaration, entry subpath, diagnostic code or source module.
  A fix that lowers one of these numbers is still welcome.

The rule is mechanical where it can be. `quality/complexity-budget.json` takes
`"frozen": { "since": "<tag>", "why": "…" }` in the commit that tags the first
candidate; `npx tsx scripts/check-complexity.ts --freeze` writes the limits of
that moment to `quality/complexity-budget.frozen.json`, committed beside it.
From then on `npm run check` fails on any limit above its frozen value and on
any metric the snapshot never saw, whatever the reason written next to the
number. The reference is a committed file rather than `git show <tag>:…`
because CI checks out one commit without tags, and a branch that raised a limit
would otherwise compare the raise with itself at `HEAD`. The freeze is lifted in
the commit that opens the next minor: remove `frozen` and the snapshot together.

What stays a reading rule: the changeset type — review reads `.changeset/*.md`
— and the start of the freeze itself, which is the same decision as tagging the
first candidate. That decision was taken on 2026-09-11 (#70, `509742c`): the
first candidate is `v2.0.0-rc.1`, not rc.0, because Changesets carries the
beta's number on when the pre tag changes. `frozen` has named that tag since,
`quality/complexity-budget.frozen.json` is committed beside the budget, and the
gate is held by eight unit cases
(`tests/unit/quality/complexity-budget.test.ts`).

2026-09-14 (2.0.1): the freeze ended when `2.0.0` reached npm, not with the
next minor as the paragraph above says (#92). `frozen` is gone from
`quality/complexity-budget.json` and `quality/complexity-budget.frozen.json` is
deleted, so `npm run check` compares limits with the budget alone again. The
mechanism stays: `--freeze` and the comparison remain in
`scripts/check-complexity.ts`, and seven unit cases hold them against a freeze
the tests set themselves.

### 7. 1.x security fixes: the way (added 2026-09-11)

`SECURITY.md` promises 1.x security fixes until 2026-12-04 or 90 days after
2.0.0 is published, whichever is later. The date was written on 2026-09-05,
exactly 90 days before it, when 2.0.0 looked days away; the second half keeps
the window from shrinking with every day the release slips.

Measured on 2026-09-11, before the work below, a 1.x fix could not ship:

- There is no `release/1.x` branch. The last 1.x release is `v1.8.1`
  (`c23d5de`), which carries no `.changeset/pre.json` and `baseBranch: main`.
- CI runs on `main` only (`ci.yml`, here and at `v1.8.1`), and the release
  accepts `main` only, three times: the `gate` job's `head_branch == 'main'`,
  `certifiedRunFrom()` in `scripts/release-gate.ts`, and its ancestry check
  against `origin/main`. `workflow_run` runs the workflow file of the default
  branch, so a `release.yml` on another branch is never the one that runs; and
  the Version PR job compares the tested commit with `github.sha`, which under
  `workflow_run` is the tip of `main` and never a 1.x commit.
- The dist-tag follows the version alone (§4), so a stable `1.8.2` goes to
  `latest`, and npm moves `latest` to whatever was published last. After
  2.0.0, `npm install payload-live-preview` would resolve 1.x again. The tree
  at `v1.8.1` passes `--tag latest` literally.
- The publish job calls two things the `v1.8.1` tree does not have:
  `scripts/github-release.ts` and `npm run test:smoke`. The artifact half
  fits — that CI uploads `release-candidate-<sha>` and its package gate takes
  a tarball.
- `scripts/github-release.ts` does not pass `--latest=false`, so whether a
  1.8.2 Release takes GitHub's Latest label from 2.0.0 is left to GitHub.

The way:

1. The fix lands on `main` first, with its regression test. 1.x gets a
   backport, never a fix 2.x lacks.
2. `release/1.x` was cut once from `v1.8.1` and is protected like `main`, with
   the check names its own `ci.yml` produces — `Build`, where `main` requires
   `Build / Build`.
3. On that branch Changesets stay in normal mode — there is no pre mode to
   exit — with `baseBranch: "release/1.x"`. A backport is
   `git cherry-pick -x <sha>` plus a `patch` changeset (a `minor` where the fix
   adds a contract), and `npm run version` in the same pull request: the Version PR exists on `main` only (§2), so on
   `release/1.x` the release commit is made by hand. A changeset merged there
   without it makes the Release run fail with that instruction.
4. A 1.x version is published under the dist-tag `legacy` (§4). `1.x` is not
   possible: npm refuses a dist-tag that parses as a semver range (npm 12.0.2,
   `dist-tag` and `publish --tag`). Before 2.0.0 a 1.8.2 still lands on
   `latest`, after it on `legacy`. If a 1.x release ever reaches `latest`, the
   repair is `npm dist-tag add payload-live-preview@<2.x version> latest`.

Done on 2026-09-11, the list this section named as missing:

- `ci.yml` on `release/1.x` runs for its pushes and pull requests, the
  release-critical gates included, and the branch's own package gate accepts
  that (`2c5b746` on `release/1.x`).
- `release.yml` and `scripts/release-gate.ts` on `main` accept `release/1.x`
  beside `main`: `RELEASE_BRANCHES` is the one list, `certifiedRunFrom()` checks
  membership, ancestry is proven against the run's own branch, and the workflow
  contract derives the gate condition from the list (`dfdddbb`). The Version PR
  condition keeps `github.sha`: `changesets/action` resets its version branch to
  that commit, so it is the one tip a Version PR can be correct for; for
  `release/1.x` the gate names the hand step instead.
- `distTagForVersion()` takes the registry's `latest` and returns `legacy` by
  the rule in §4, and `scripts/github-release.ts` passes `--latest=false`
  whenever the dist-tag is not `latest` (`296ad46`).
- The branch carries the tooling the publish job calls, in one commit (`2c5b746`):
  `publish-artifact.ts` and `release-version.ts` as on `main`,
  `github-release.ts` with its two runner types declared locally, and
  `post-publish-smoke.ts` with the 1.8.1 export map and `test:smoke`. Run against
  the published `1.8.1`, `npm run test:smoke` passed.
- Found on the way: npm 12 prints a single-field `npm view --json` as a
  one-element array, so the post-publish integrity check refused a correct
  answer; both shapes are read now (`69c9b1a`).
- The audit gates the 1.8.1 tree failed are cleared on the branch (`6ae2a31`,
  #72): `npm audit fix` took every advisory inside the declared ranges,
  lockfiles only and no manifest change — the root tree (`js-yaml`,
  `fast-uri`) and the astro, nextjs, nuxt and payload-backend fixtures
  (`astro`, `next`, `sharp`, `svgo`). Every high and critical audit is 0
  there, so a pull request into `release/1.x` can merge again.

Open:

- No backport has been made, and the fix that looked like the first candidate
  is not one: the replay race from #64 does not exist on 1.x. `v1.8.1` carries
  no `src/security/preview-token.ts` and no `PreviewTokenReplayChecks` — the
  token layer arrived with 2.0 (`14e967d`, #57) — so a backport would open the
  gap rather than close it. The way stays unused until a 1.x security fix is
  found.
- A re-entry by `workflow_dispatch` runs on main's ref, so a 1.x run re-entered
  that way shares main's concurrency group and queues with it.

### 8. 2.0 patches alongside the next minor (added 2026-10-03)

`main` carries changesets for the next minor, so a patch for the published 2.0
line needs a separate `release/2.0` branch from the last published 2.0 tag. The
branch takes the patch and its regression test without the pending minor work.

CI accepts pushes and pull requests for that exact branch. A push runs the
same release-critical gates as `main`, including the nightly mutation scope
and the five-minute browser soak. The release gate proves ancestry against
`origin/release/2.0`; the publish job consumes that run's certified archive.
The default branch must carry the updated release workflow before a maintenance
run can release, because `workflow_run` reads that workflow from the default
branch.

Changesets on the maintenance branch use `baseBranch: "release/2.0"`. Run
`npm run version` in the maintenance pull request, as for 1.x (§7); automatic
Version PRs remain on `main` only. The dist-tag rule in §4 is unchanged: a 2.0
patch below an already published 2.1 `latest` is refused, so this route publishes
2.0.6 before 2.1.0.

### 9. Nightly policy scope correction (2026-10-03)

The official [Main CI report](https://github.com/relative23/payload-live-preview/actions/runs/35471423974)
and [Deep Quality report](https://github.com/relative23/payload-live-preview/actions/runs/37108394350)
for `9f66fbf` both contain 64 mutated files; the policy named 63. Both reports'
embedded sources match that commit byte for byte. The missing policy entry is
`src/core/lifetime-scope.ts`, which the actual nightly configuration already
includes.

The policy now names that file and lowers the no-coverage maximum from 75 to
the measured 71. The total of 7,333 mutants, the 84.69% score minimum, the
45-mutant drift band and every other limit stay unchanged. This corrects the
policy for the existing reports; the separate property-exploration failure
remains open.

### 10. Project-scoped audit exceptions (2026-10-03)

CI audits development dependencies in the root package and all ten examples.
After updates within the maintained dependency ranges, seven project/advisory
combinations remain without a patched release in their current major track:
[braces 3](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) in the root and Nuxt,
[node-forge 1](https://github.com/advisories/GHSA-86w9-cpqp-85rv) in Nuxt, and
[http-cache-semantics 4](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) in four
Astro examples. Their temporary exceptions expire at the end of 2026-10-10 UTC.

Each exception names one project, advisory, leaf version and integrity. It also
binds the affected dependency graph, including parent fix suggestions, and a
reviewed source/configuration/caller descriptor. Empty descriptors, new findings,
changed pins and unused exceptions fail. Every invocation validates all register
entries and dates, then uses only the selected project's exceptions. Audit or
registry errors cannot supply a clean result; both subprocesses have finite
SIGKILL time limits. A fresh official registry query requires another review as
soon as a newer stable version appears in the exception's major track.

The reviewed contexts are Changesets' single-package discovery, the Nuxt
example's HTTP build/development setup, and Astro image-build callers in examples
that use plain image tags. The descriptors bind those contexts to the measured
sources and caller identities. These Main profiles need a separate reachability
review and fresh pins before use on another source branch. Package version and
Changesets base-branch metadata are omitted from the security projections so a
version-only change keeps an otherwise valid binding.

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
