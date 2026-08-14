# Contributing

Thanks for contributing to `payload-live-preview`. This document covers everything you need to get a change from clone to merged PR.

## Development setup

Requirements: Node.js >= 20.19 and the npm version declared by
`packageManager`.

```sh
git clone https://github.com/relative23/payload-live-preview.git
cd payload-live-preview
npm install --global "$(node -p "require('./package.json').packageManager")"
npm ci
npm run build:runtime   # required before typecheck (generates src/inline/runtime.generated.ts)
npm run check           # typecheck + lint + unit/integration tests
```

The complete risk-to-gate map, including mutation, property, package, browser,
performance, and leak testing, is documented in [docs/testing.md](docs/testing.md).

End-to-end tests need Playwright browsers installed once:

```sh
npx playwright install
npm run test:e2e
```

## Project layout

| Path                                                                                       | Purpose                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/core`                                                                                 | Framework-agnostic runtime (message bus, origin detection, DOM patching) |
| `src/adapters/astro`, `src/adapters/nextjs`, `src/adapters/sveltekit`, `src/adapters/nuxt` | Framework adapters                                                       |
| `src/security`                                                                             | Sanitizer, escaping, URL validation, CSP helpers                         |
| `src/lexical`                                                                              | Lexical rich-text rendering                                              |
| `src/codegen`                                                                              | Schema-driven code generation and CLI                                    |
| `tests/unit`, `tests/integration`, `tests/e2e`                                             | Vitest unit/integration suites and Playwright e2e                        |

## The single-source runtime

The browser runtime lives in `src/core/runtime.ts`. `scripts/build-runtime.ts` bundles it and bakes the result into `src/inline/runtime.generated.ts`, which is what adapters inline into pages.

If you touch `src/core/runtime.ts` or anything it imports, regenerate the baked copy:

```sh
npm run build:runtime
```

The generated file is intentionally gitignored and remains local. Do not stage it;
`npm run build:runtime` and `npm run build` regenerate it, and the completed build
embeds it in the published artifacts. Consumer installation deliberately runs no
package lifecycle build: published archives already contain the reviewed output.

## Changesets

Releases are managed with [changesets](https://github.com/changesets/changesets). Every PR that changes published behavior must include one:

```sh
npx changeset
```

Pick the appropriate bump (patch for fixes, minor for features) and write a short, user-facing summary. Docs-only or internal-only changes do not need a changeset.

## Code style

- Strict TypeScript; no `any` unless unavoidable and justified.
- ESLint and Prettier are enforced: `npm run lint`, `npm run format:check`.
- `npm run check`, `npm run format:check`, `npm run build`, and
  `npm run test:package` must pass before release. The package test packs and
  installs the exact archive in isolated OS-temporary consumers under npm's strict
  install-script policy. Peer-free exports cannot inherit maintainer dependencies;
  codegen is tested separately with its declared peer. The gate rejects `preinstall`,
  `install`, `postinstall`, and `prepare` hooks and does not publish anything.
  CI persists the verified tgz and its digest/content manifest; the release lane
  rechecks and publishes those exact bytes rather than rebuilding or asking npm
  to repack the repository.

## Pull requests

- Keep PRs focused; one logical change per PR.
- Behavior changes require tests (unit tests at minimum; e2e if the change affects iframe/postMessage behavior).
- Security-sensitive changes (anything under `src/security`, origin detection, or message validation) must include tests in `tests/unit/security`.
- Update docs under `docs/` and the README when public API or behavior changes.
- Include a changeset when behavior changes (see above).

If you are unsure whether an idea fits, open an issue or a discussion before writing code.
