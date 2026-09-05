# Tests

`scripts/test-policy.ts` groups every test file by the directory it lives in
and by the runner that owns it. These are the seven groups, and there is no
other place a test may live:

| Directory              | Runner (config)                                  | npm script                                  | What goes here                                                                                                            |
| ---------------------- | ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/`          | Vitest (`vitest.config.ts`)                      | `npm run test:unit`                         | One module or boundary in jsdom; fast-check properties in `property/`; the gate scripts in `quality/`                     |
| `tests/integration/`   | Vitest (`vitest.config.ts`)                      | `npm run test:integration`                  | The runtime or client wired up end to end in jsdom; the wire-corpus replay; the codegen round trip on an in-memory config |
| `tests/e2e/`           | Playwright (`playwright.config.ts`)              | `npm run test:e2e`                          | Real browsers against the example apps in `examples/`                                                                     |
| `tests/real-payload/`  | Playwright (`playwright.real-payload.config.ts`) | `npm run test:e2e:real-payload`             | A real Payload admin driving the preview; records the wire corpus                                                         |
| `tests/soak/`          | Playwright (`playwright.soak.config.ts`)         | `npm run test:soak`                         | Sustained update and heap soak in Chromium                                                                                |
| `tests/benchmarks/`    | Vitest bench (`vitest.bench.config.ts`)          | `npm run test:bench`, `test:bench:codspeed` | CPU and allocation trends on the hot paths                                                                                |
| `tests/browser-bench/` | Playwright (`playwright.bench.config.ts`)        | `npm run test:browser-bench`                | The update-to-paint trend in Chromium                                                                                     |

`npm test` runs the two Vitest groups. Where does a new test go?

- A pure function, one class, one parser: `tests/unit/<domain>/`, mirroring
  the `src/` directory of the code under test. Security boundaries go in
  `tests/unit/security/`; a fast-check property in `tests/unit/property/`.
- Behaviour that needs the runtime or client assembled — messages in, DOM
  out: `tests/integration/`, on the harnesses there.
- Anything that needs a real browser, an iframe or `postMessage` across
  origins: `tests/e2e/specs/`, against a fixture from `examples/`.
- Anything that needs the real admin: `tests/real-payload/`.

## Helpers and fixtures

- `tests/helpers/runtime.ts` — the one runtime harness for the jsdom suites:
  trusted origin, text renderer and message envelope are shared, only the
  axes that differ are parameters.
- `tests/integration/runtime-harness.ts`, `client-harness.ts`,
  `tests/e2e/helpers/preview.ts` — the assembled runtime, the client, and the
  page-side driver for the browser specs.
- `tests/setup.ts` — Vitest setup for every unit and integration file.
- `tests/fixtures/wire-corpus/` — one capture per Payload version of what the
  admin actually sends, replayed through the real runtime by
  `tests/integration/wire-corpus.test.ts`. Record a new version with
  `PLP_RECORD_CORPUS=1 npm run test:e2e:real-payload` after bumping
  `examples/payload-backend`; `npm run compat:check` then expects the version
  in `quality/compat-matrix.json`.
- `tests/fixtures/real-payload-message.json` — one message captured verbatim
  from a Payload 3.85 admin, driven through the real bus and runtime by
  `tests/integration/real-payload-protocol.test.ts`.

## After adding, renaming or moving a test

```sh
npx tsx scripts/test-policy.ts --write
```

That regenerates `quality/test-inventory.json`; CI fails on a stale inventory.
Focused, skipped, todo, conditional and expected-failure declarations have a
budget of zero, so a test that must not run yet is not committed.
