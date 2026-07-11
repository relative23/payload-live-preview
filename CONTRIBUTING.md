# Contributing

Thanks for contributing to `payload-live-preview`. This document covers everything you need to get a change from clone to merged PR.

## Development setup

Requirements: Node.js >= 18.18.

```sh
git clone https://github.com/relative23/payload-live-preview.git
cd payload-live-preview
npm install
npm run build:runtime   # required before typecheck (generates src/inline/runtime.generated.ts)
npm run check           # typecheck + lint + unit/integration tests
```

End-to-end tests need Playwright browsers installed once:

```sh
npx playwright install
npm run test:e2e
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/core` | Framework-agnostic runtime (message bus, origin detection, DOM patching) |
| `src/adapters/astro`, `src/adapters/nextjs`, `src/adapters/sveltekit`, `src/adapters/nuxt` | Framework adapters |
| `src/security` | Sanitizer, escaping, URL validation, CSP helpers |
| `src/lexical` | Lexical rich-text rendering |
| `src/codegen` | Schema-driven code generation and CLI |
| `tests/unit`, `tests/integration`, `tests/e2e` | Vitest unit/integration suites and Playwright e2e |

## The single-source runtime

The browser runtime lives in `src/core/runtime.ts`. `scripts/build-runtime.ts` bundles it and bakes the result into `src/inline/runtime.generated.ts`, which is what adapters inline into pages.

If you touch `src/core/runtime.ts` or anything it imports, regenerate the baked copy:

```sh
npm run build:runtime
```

Commit the regenerated file with your change. CI and `npm run typecheck` will fail if it is stale or missing.

## Changesets

Releases are managed with [changesets](https://github.com/changesets/changesets). Every PR that changes published behavior must include one:

```sh
npx changeset
```

Pick the appropriate bump (patch for fixes, minor for features) and write a short, user-facing summary. Docs-only or internal-only changes do not need a changeset.

## Code style

- Strict TypeScript; no `any` unless unavoidable and justified.
- ESLint and Prettier are enforced: `npm run lint`, `npm run format`.
- `npm run check` must pass before you open a PR.

## Pull requests

- Keep PRs focused; one logical change per PR.
- Behavior changes require tests (unit tests at minimum; e2e if the change affects iframe/postMessage behavior).
- Security-sensitive changes (anything under `src/security`, origin detection, or message validation) must include tests in `tests/unit/security`.
- Update docs under `docs/` and the README when public API or behavior changes.
- Include a changeset when behavior changes (see above).

If you are unsure whether an idea fits, open an issue or a discussion before writing code.
