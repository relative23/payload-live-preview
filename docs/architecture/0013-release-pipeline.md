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
`push` run of this repository on a release branch — `main` or `release/1.x`,
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
its version already on npm, the gate fails and names the hand step (§7). The
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
`scripts/publish-artifact.ts` takes the version and the version the registry
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
— and the start of the freeze itself, which is the same decision as tagging
`rc.0`. Today there is no release candidate; `frozen` is unset and the gate is
held by seven unit cases (`tests/unit/quality/complexity-budget.test.ts`).

### 7. 1.x security fixes: the way (added 2026-09-11)

`SECURITY.md` promises 1.x security fixes until 2026-12-04 or 90 days after
2.0.0 is published, whichever is later. The date was written on 2026-09-05,
exactly 90 days before it, when 2.0.0 looked days away; the second half keeps
the window from shrinking with every day the release slips.

Measured on 2026-09-11, a 1.x fix could not ship:

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

The way, once the steps below exist:

1. The fix lands on `main` first, with its regression test. 1.x gets a
   backport, never a fix 2.x lacks.
2. The branch is cut once from the last 1.x tag and protected like `main`:

   ```sh
   git fetch origin --tags
   git switch -c release/1.x v1.8.1
   git push -u origin release/1.x
   ```

3. On that branch Changesets stay in normal mode — there is no pre mode to
   exit — with `baseBranch: "release/1.x"`. A backport is
   `git cherry-pick -x <sha>` plus a `patch` changeset; the Version PR makes
   it `1.8.2`.
4. A 1.x version is published under the dist-tag `legacy`. `1.x` is not
   possible: npm refuses a dist-tag that parses as a semver range (npm 12.0.2,
   `dist-tag` and `publish --tag`). The rule that serves both periods is "a
   stable version whose major is below the major `latest` serves goes to
   `legacy`": before 2.0.0 a 1.8.2 still lands on `latest`, after it on
   `legacy`. If a 1.x release ever reaches `latest`, the repair is
   `npm dist-tag add payload-live-preview@<2.x version> latest`.

Missing before step 2 is worth taking, and not made here, because each is a
workflow or release-script change:

- `ci.yml` on the branch runs on `release/1.x`.
- `release.yml` and `scripts/release-gate.ts` on `main` accept `release/1.x`
  beside `main`: the `gate` condition, `certifiedRunFrom()`, the ancestry check
  against the run's own branch, and a Version PR condition that compares with
  that branch's tip instead of `github.sha`.
- `distTagForVersion()` takes the registry's `latest` as a second input and
  returns `legacy` by the rule above.
- `scripts/github-release.ts` passes `--latest=false` for that case.
- The branch gets the publish tooling the job calls — `github-release.ts`,
  `post-publish-smoke.ts` with `test:smoke`, and the new dist-tag rule — in
  one commit before the first backport.

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
