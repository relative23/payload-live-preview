# Contributing

Thanks for contributing to `payload-live-preview`. This document covers everything you need to get a change from clone to merged PR, and what happens to it after the merge.

## Development setup

Requirements: Node.js >= 20.19 and the npm version declared by
`packageManager`.

```sh
git clone https://github.com/relative23/payload-live-preview.git
cd payload-live-preview
npm install --global "$(node -p "require('./package.json').packageManager")"
npm ci
npm run build:runtime   # required before typecheck (generates the src/inline/*.generated.ts files)
npm run check           # typecheck, lint, formatting, test/architecture policy, compat table, Vitest
```

`npm run check` runs what the CI "Lint & Typecheck" job runs, with one
exception: `npm run audit:gate` (`npm audit` held against the exception
register in `quality/audit-exceptions.json`) needs the npm registry, so it is
not part of `check`. Run it yourself when you change a dependency or a
lockfile. Local green then means CI green for that job.

The complete risk-to-gate map, including mutation, property, package, browser,
performance, and leak testing, is documented in [docs/testing.md](docs/testing.md).

### End-to-end tests

The Playwright suite runs against the example apps under `examples/`. They
depend on the package through `file:../..`, which means they install `dist/`,
not the sources. Browsers are installed once:

```sh
npx playwright install
```

Then, after every change you want the browsers to see:

```sh
npm run build
for fixture in astro-payload nextjs-payload sveltekit-payload nuxt-payload \
  astro-hybrid pure-html vanilla-client astro-inline astro-middleware; do
  npm ci --no-audit --no-fund --prefix "examples/$fixture"
done
npm run check:fixtures                      # fails on a fixture that still carries an older build
npm run test:e2e                            # every fixture, three browsers
PLP_E2E_SERVERS=astro npm run test:e2e      # one fixture; names are the webServer names in playwright.config.ts
```

`astro-payload`, `nextjs-payload`, `sveltekit-payload` and `nuxt-payload`
install a packed copy of the package rather than a link, and `npm install`
keeps that copy while the manifest is unchanged. `npm run check:fixtures` names
the stale copy and the command that replaces it. The fixture table, ports and
delivery modes are in [examples/README.md](examples/README.md).

## Project layout

| Path                                                                | Purpose                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/core`                                                          | Framework-agnostic runtime: message bus, scheduler, DOM patching, keyed morph, strategies seam  |
| `src/client`                                                        | `LivePreviewClient` — the runtime with its own emitter, plugin manager and renderer registry    |
| `src/inline`                                                        | `generateInlineScript()` and the generated runtime, loader and fragment files it embeds         |
| `src/fragment`                                                      | The fragment and route strategies (`payload-live-preview/fragment`, ADR 0011)                   |
| `src/adapters/{astro,nextjs,sveltekit,nuxt}`, `src/adapters/shared` | Framework adapters and the request policy they share                                            |
| `src/security`                                                      | Sanitizer, escaping, URL validation, CSP helpers                                                |
| `src/lexical`                                                       | Lexical rich-text rendering                                                                     |
| `src/field-types`                                                   | Built-in field renderers                                                                        |
| `src/schema`                                                        | Payload field-schema parsing, lookup index and array diff                                       |
| `src/detection`                                                     | Preview-context, origin and locale detection                                                    |
| `src/events`, `src/plugins`, `src/dsl`                              | Event emitter; plugin manager and built-in plugins; the binding DSL                             |
| `src/types`                                                         | Shared wire and context types — a leaf domain that imports nothing at runtime                   |
| `src/server`, `src/payload`                                         | Privileged server helpers (`./server`); `payload.config.ts` helpers (`./payload`)               |
| `src/codegen`, `src/migrate`, `src/doctor`                          | Schema-driven code generation, the 1.x → 2.0 codemods, the deployment probe — server-only tools |
| `src/index.ts`, `src/*-entry.ts`                                    | The package entries; `etc/api/` holds one API report per entry                                  |
| `scripts/`                                                          | Build, gate and release tooling; each gate's header comment says what it protects               |
| `quality/`                                                          | The machine-readable baselines the gates compare against                                        |
| `etc/api/`                                                          | API Extractor reports, regenerated by `npm run api:update`                                      |
| `type-tests/`                                                       | Packed public type fixtures used by `npm run test:package`                                      |
| `tests/`                                                            | Vitest and Playwright suites; see [tests/README.md](tests/README.md)                            |
| `examples/`                                                         | Demo apps that double as E2E fixtures; see [examples/README.md](examples/README.md)             |
| `docs/architecture/`                                                | Decision records; the index is [docs/architecture/README.md](docs/architecture/README.md)       |

`npm run api:update` rebuilds and repacks the package and regenerates the API
Extractor reports under `etc/api/` from the packed archive. Run it only for an
intentional public-API change, review the report diff, and include the
matching changeset; it is not a formatter.

## The single-source runtime

The browser runtime lives in `src/core/runtime.ts`. `scripts/build-runtime.ts` bundles it and bakes the result into three files that adapters inline into pages:

- `src/inline/runtime.generated.ts`
- `src/inline/loader.generated.ts`
- `src/inline/fragment.generated.ts`

If you touch `src/core/runtime.ts` or anything it imports, regenerate them:

```sh
npm run build:runtime
```

All three are build outputs and all three are gitignored. Do not stage them: a
committed copy drifts from its source the moment somebody edits the runtime
without rebuilding, and a stale one is indistinguishable from a reviewed one in
a diff. `npm run build:runtime` and `npm run build` regenerate them, `pretest`
regenerates them before `npm test`, and every CI job that type-checks or runs
tests regenerates them first. The completed build embeds them in the published
artifacts; consumer installation deliberately runs no package lifecycle build,
because published archives already contain the reviewed output.

## Gates and their baselines

Every gate compares the tree against something reviewed. The table says what
that is and how it is changed on purpose; a gate is never made green by editing
the number it reports.

| Gate (script · command)                                                 | What it protects                                                                                                            | Baseline                                                               | Legitimate update                                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `test-policy.ts` · `npm run test:policy`                                | Every test file is inventoried and grouped by its runner; focused, skipped, todo and expected-failure declarations budget 0 | `quality/test-inventory.json`                                          | `npx tsx scripts/test-policy.ts --write` after adding, renaming or moving tests                                                         |
| `coverage-policy.ts` · `npm run test:coverage:diff`                     | Global and critical-file coverage floors, changed-line coverage against the base commit                                     | `quality/coverage-policy.json`                                         | Raise a floor or add a critical file; a threshold cannot be lowered, a baseline removed, or a diff ignore pattern added                 |
| `mutation-policy.ts` · `npm run test:mutation:policy[:pr]`              | The exact reviewed Stryker outcome: scope, total, score, no-coverage, timeout, error and ignored counts                     | `quality/mutation-policy.json`, `quality/mutation-policy-pr.json`      | Record the numbers of a fresh run by hand; the procedure is in [docs/testing.md](docs/testing.md). Improvements fail too until recorded |
| `architecture-rules.ts` · `npm run test:architecture`                   | Layer deny-lists, the server/browser boundary, Node builtins in browser code, runtime cycles                                | The deny-list table in the script (ADR 0012)                           | Edit the table with the reason; type-only imports are exempt                                                                            |
| `workflow-contracts.ts` · `npm run test:architecture`                   | Each workflow's required steps, order, conditions, permissions, matrices; actions pinned to a commit SHA                    | `scripts/workflow-expectations*.ts`                                    | Mirror the workflow change in the expectations file in the same commit                                                                  |
| `check-bundle-size.ts` · `npm run test:bundle` (inside `npm run build`) | Raw, gzip and Brotli budgets per entry and for the inline script                                                            | `scripts/bundle-budgets.ts`, `ENTRY_BUDGETS` in `check-bundle-size.ts` | Raise a budget in the commit that spends it, with the reason in the ledger comment; a drop above 2 % prints a notice to tighten it      |
| `docs-contracts.ts` · `npm run test:docs`                               | Entries, diagnostic codes, `lp-` classes and `data-payload-` attributes named in README and `docs/` exist in `src/`         | The source itself                                                      | Fix the prose or the source; there is no exception list                                                                                 |
| `release-gate.ts` · Release workflow                                    | Only a completed, successful CI push run on `main` of this repository is versioned or published                             | None; the verdict is computed from Git, npm and GitHub state           | `workflow_dispatch` with the CI `run_id` re-enters a certified run; a tag on another commit is an error, not repaired                   |
| `api-contracts.ts` · `npm run test:package`                             | One API Extractor report per entry and the exact `ae-forgotten-export` count                                                | `etc/api/*.api.md`, `FORGOTTEN_EXPORT_BASELINE` in the script          | `npm run api:update`, review the diff, change the constant with a comment on what moved; include a changeset                            |
| `check-fixture-freshness.ts` · `npm run check:fixtures`                 | The copy-installed fixtures carry the build in `dist/`                                                                      | None; `dist/index.js` is hashed against each installed copy            | `rm -rf examples/<name>/node_modules/payload-live-preview && npm install --prefix examples/<name>`                                      |

## Workflow contracts

Every file under `.github/workflows/` is held to `scripts/workflow-expectations.ts`,
`workflow-expectations-ci.ts` and `workflow-expectations-shared.ts`: a required
step exists exactly once with its exact `run` or `uses`, carries no condition,
uses no shell operator unless whitelisted, and every action is pinned to a full
commit SHA. Any edit to a workflow is mirrored in those files in the same commit,
or `npm run test:architecture` fails. The `build` job in `ci.yml` calls the
reusable `build.yml`, so the check it reports is named `Build / Build` — the
exact string the branch protection on `main` requires. Renaming either job
leaves every pull request blocked with all checks green until the protection
follows.

## Changesets

Releases are managed with [changesets](https://github.com/changesets/changesets). Every PR that changes published behavior must include one:

```sh
npx changeset
```

Pick the appropriate bump (patch for fixes, minor for features) and write a short, user-facing summary. Docs-only or internal-only changes do not need a changeset.

## Release

Nothing is published from a laptop. From a merge to npm:

1. A push to `main` runs CI. Its Build job builds once, verifies the archive
   with `npm run test:package`, and stores the tgz with its manifest as the
   artifact `release-candidate-<sha>`.
2. A successful CI push run triggers the Release workflow (`workflow_run`).
   `scripts/release-gate.ts` reads the tested commit and decides: the version
   in `package.json` is not on npm → publish; it is, and `.changeset/` holds
   changesets → Version PR; otherwise nothing.
3. Version PR: `changesets/action` runs `npm run version` and opens or updates
   the PR titled `chore: release`. Review the CHANGELOG entry and merge it;
   that merge is the push that publishes.
4. Publish: the workflow downloads the exact CI artifact, reruns the package
   gate on it, publishes those bytes with provenance (`npm run release`),
   verifies the registry copy, pushes the `v<version>` tag, creates the GitHub
   Release from the CHANGELOG section (`scripts/github-release.ts`) and installs
   the published package from the registry (`npm run test:smoke`). A prerelease
   (`2.0.0-beta.0`) publishes under its label as dist-tag (`beta`), never `latest`.
5. A run whose release was skipped — a newer push landed while its CI was
   still running — is re-entered by hand: `gh workflow run release.yml -f run_id=<CI run id>`.

Bump versions only with `npm run version`. It runs `changeset version` and then
`scripts/sync-lockfile-metadata.ts`, which copies the new name and version into
the root lockfile and the four `file:../..` fixture lockfiles. A manual
`npm version` leaves those behind, and `npm run test:package` then fails with
`package-lock.json … must match …` until `npm run version` has run. The
pipeline as a whole is ADR [0013](docs/architecture/0013-release-pipeline.md).

## Code style

- Strict TypeScript; no `any` unless unavoidable and justified.
- ESLint and Prettier are enforced: `npm run lint`, `npm run format:check`
  (both part of `npm run check`).
- `npm run check`, `npm run build`, and `npm run test:package` must pass
  before release. The package test packs and installs the exact archive in
  isolated OS-temporary consumers under npm's strict install-script policy.
  Peer-free exports cannot inherit maintainer dependencies; codegen is tested
  separately with its declared peer. The gate rejects `preinstall`, `install`,
  `postinstall`, and `prepare` hooks and does not publish anything.

## Pull requests

- Keep PRs focused; one logical change per PR.
- Behavior changes require tests (unit tests at minimum; e2e if the change affects iframe/postMessage behavior).
- Security-sensitive changes (anything under `src/security`, origin detection, or message validation) must include tests in `tests/unit/security`.
- Update docs under `docs/` and the README when public API or behavior changes.
- Include a changeset when behavior changes (see above).

If you are unsure whether an idea fits, open an issue or a discussion before writing code.
