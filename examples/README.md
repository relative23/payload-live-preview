# Example apps

Each directory is a demo a consumer can copy and, at the same time, a
Playwright fixture. Every fixture that uses the package depends on it through
`file:../..`, so it runs the build in `dist/`, not the sources: run
`npm run build` before installing one, and `npm run check:fixtures` afterwards.

| Fixture             | Delivery                                                                   | Port | Specs / CI job                                                                                               | Refresh after a build |
| ------------------- | -------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| `astro-payload`     | `payload-live-preview/astro`, `mode: 'loader'`                             | 4173 | Every spec that uses the `baseURL`; E2E, Astro matrix, Real Payload E2E, the soak and the browser bench      | copy                  |
| `astro-inline`      | `payload-live-preview/astro`, `mode: 'inline'`                             | 4182 | `reveal.spec.ts`; E2E                                                                                        | link                  |
| `astro-middleware`  | `payload-live-preview/astro`, `mode: 'middleware'`                         | 4183 | `reveal.spec.ts`; E2E                                                                                        | link                  |
| `astro-hybrid`      | Astro SSR (Node adapter) rendering fragments on the server                 | 4177 | `hybrid-fragment.spec.ts`; E2E, Real Payload E2E (hybrid)                                                    | link                  |
| `nextjs-payload`    | `generateInlineScript()` in the root layout (React)                        | 4174 | `nextjs-live-preview.spec.ts`, `navigation-lifecycle-per-framework.spec.ts`, `reveal.spec.ts`; E2E           | copy                  |
| `sveltekit-payload` | `livePreviewHandle` from `payload-live-preview/sveltekit`                  | 4175 | `sveltekit-live-preview.spec.ts`, `owner-scoping.spec.ts`, `navigation-lifecycle-per-framework.spec.ts`; E2E | copy                  |
| `nuxt-payload`      | `livePreviewNitroPlugin` from `payload-live-preview/nuxt`                  | 4176 | `nuxt-live-preview.spec.ts`, `navigation-lifecycle-per-framework.spec.ts`, `reveal.spec.ts`; E2E             | copy                  |
| `pure-html`         | Static HTML carrying the inline runtime from `generateInlineScript()`      | 4180 | `reveal.spec.ts`; E2E                                                                                        | link                  |
| `vanilla-client`    | Bundled SPA calling `initLivePreview()` from `payload-live-preview/client` | 4181 | `reveal.spec.ts`; E2E                                                                                        | link                  |
| `payload-backend`   | A real Payload admin; does not depend on the package                       | 3001 | `tests/real-payload/` through `npm run test:e2e:real-payload`; Real Payload E2E                              | —                     |

The ports, start commands and the name each fixture answers to are in
`playwright.config.ts` (`payload-backend`: `playwright.real-payload.config.ts`).
`PLP_E2E_SERVERS=<names>` starts only the named fixtures — `astro`, `nextjs`,
`sveltekit`, `nuxt`, `hybrid`, `pure-html`, `vanilla-client`, `astro-inline`,
`astro-middleware` — and `PLP_E2E_PORT` moves `astro-payload` off 4173 when
another project holds it. The CI E2E job installs all nine package fixtures
(`CI_FIXTURES` in `scripts/workflow-expectations-shared.ts`); the fixture audit
job runs `npm audit` on all ten lockfiles.

## Refresh after a build

The two values in the last column are the two ways a lockfile records
`file:../..`:

- **link** — the lockfile says `"link": true`, npm symlinks the repository
  root, and the fixture sees every build as soon as it exists. Nothing to do.
- **copy** — the lockfile resolves to a version, npm materialises a packed
  copy, and `npm install` keeps that copy while the manifest is unchanged. The
  fixture then runs the library as it was when the copy was made, and the E2E
  suite passes against it without saying so. Replace the copy first:

  ```sh
  rm -rf examples/<name>/node_modules/payload-live-preview && npm install --prefix examples/<name>
  ```

  `npm ci --prefix examples/<name>` also refreshes it, because it removes
  `node_modules` before installing. `npm run check:fixtures` hashes
  `dist/index.js` against each installed copy and names the stale ones.

Keeping both kinds is deliberate: a copy is what a consumer installs, so the
four copy fixtures exercise the packed layout and the `files` field rather than
the working tree.

`next dev` (Next.js 16) writes `AGENTS.md` and `CLAUDE.md` into
`examples/nextjs-payload/`; both are gitignored and not part of the example.
