# Compatibility

The [README](../README.md#compatibility) has the summary tables. This page has
the support policy for each Payload major, what differs between them, and what
runs against each version.

## Payload

**Payload 3.x** is supported. Every adapter's example runs against a real
Payload 3 admin on every push, in Chromium, Firefox and WebKit.

**Payload 4** is where this package is headed. Its pre-releases are followed as
they appear, and support becomes official with the stable 4.0 release; until
then the daily run against `payload@beta` warns early and does not gate a
release. The captured pre-releases pass the same protocol checks as the 3.x
captures. As of 4.0.0-beta.6, Payload 4 needs Node 24.22.1 or later, and its
admin Next.js 16.4 or a later 16.x release.

**Payload 2.x** support ends with the next major release of this package: 3.0
supports Payload 3.x and 4.x, and every 2.x release keeps supporting Payload 2
([ADR 0007 ledger, entry 25](architecture/0007-v2-defaults-and-renames-ledger.md#ledger),
[Preparing for 3.0](migration.md#preparing-for-30)).

The manifest declares `payload` as an optional peer,
`^2.0.0 || ^3.0.0 || ^4.0.0-0`: npm never installs it, and a project that has
Payload outside that range gets npm's `ERESOLVE` error.

### What differs between Payload 2, 3 and 4

|                                                | Payload 2.x                                                                                                                                              | Payload 3.x                                                           | Payload 4.x (pre-release)                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Scalar field updates                           | ✅                                                                                                                                                       | ✅                                                                    | ✅                                                                          |
| Rich text (Lexical)                            | ✅                                                                                                                                                       | ✅                                                                    | ✅ through a fragment render (beta.4) and the client-side renderer (beta.6) |
| Relationship / upload population               | Collection GETs from the accepted schema with `serverURL` and matching depth (relationships measured against a real 2.32.3 admin, uploads by unit tests) | ✅ with `serverURL` (REST merge)                                      | uploads ✅ with `serverURL` (beta.6); relationships not measured yet        |
| Schema-driven field typing (`fieldSchemaJSON`) | ✅                                                                                                                                                       | — (3.x removed it; DOM heuristics + Lexical auto-detection take over) | — (as in 3.x)                                                               |

## What runs against each version

<!-- compat-evidence:start -->

On every push:

- Payload 3.92.1: every adapter's example runs against the real admin, `examples/payload-backend`, in Chromium, Firefox and WebKit.
- Payload 2.32.3: `fieldSchemaJSON` typing in `tests/integration/schema-driven.test.ts`.
- Payload 2.32.3, 3.85.0, 3.88.0, 3.89.0, 4.0.0-beta.4, 4.0.0-beta.6: the messages a real admin of each version sent, captured once and replayed in `tests/integration/wire-corpus.test.ts`.

Every day:

- Payload latest: the protocol watch runs `@payloadcms/live-preview@latest` against the captured messages, and the real-admin suite against `payload@latest`.
- Payload 4.0 pre-releases: the same against `@payloadcms/live-preview@beta` and `payload@beta`; a failure there warns and does not gate a release.

Outside CI:

- Payload 4.0.0-beta.6: on 2026-11-02, the 7 cases of `tests/real-payload/surface-findings.spec.ts` passed in Chromium, Firefox and WebKit against the admin fixture with beta.6 installed over it (Node 24.22.1); an upload reached an `<img>` inside a `<picture>` through the REST merge, and a Lexical edit was written by the client-side renderer, internal link included. Relationships were not part of the run.
- Payload 4.0.0-beta.4: on 2026-10-24, in a consumer project on 2.1.0 (Next.js 16, Node 24), the config plugin type-checked against Payload's declarations and passed its config sanitizing; for six documents in two locales it built the URL a hand-written callback produced, apart from the order of the query parameters, and the locale reached the path resolvers; the `payload-session` strategy authorized against an admin with a `csrf` list once its `origin` option was set. Globals, the create screen, drafts and autosave, other plugins that write a Live Preview URL and replacing breakpoints were not part of the run.
- Payload 4.0.0-beta.4 with Astro 7.4.2: on 2026-10-26, a 2.2 release candidate on a consumer site: typing into a title and a text line patched the preview, typing into a rich-text field updated it through 7 fragment renders that answered 200, the frame never reloaded, and all 31 messages had the shape of the captured ones. Relationships and uploads were not part of the run.
- Payload 2.32.3: the [local release checks](testing.md#local-release-checks) drive the real admin in DOM, React and Vue previews, in frontend-only and `serverURL` modes (24 browser cases per variant), and take the React hook and the Vue composable through three lifecycle journeys (9 browser cases per variant) and seven guard journeys (21 browser cases per variant) in development builds; the Payload 2 dependency graph retains upstream audit findings.

Every version in the README's framework table is what the fixture lockfile or the matrix job installs, checked by `npm run compat:check`.

Of the 61 feature rows of `quality/compat-matrix.json`, 58 passed in the CI run the last Version PR recorded (commit `df05517`, 2026-11-04, `quality/compat-results.json`); the other 3 have no recorded result.

Vite 5 through 8: that is what the supported framework majors install (Astro 7 → 8, Astro 6 → 7, Astro 5 → 6, Astro 4 → 5, SvelteKit 3 → 8, SvelteKit 2 → 5/6/7/8, Nuxt 4 → 8, Nuxt 3 → 7), measured 2026-11-03. `npm run compat:check` keeps the devDependency and the fixture lockfiles inside that span; `npm run compat:refresh` re-reads it from the registry.

The framework hooks and fragment renderers run twice on every push: at the floor of each peer range, as unit tests in jsdom that the `hook-matrix` job runs after installing the floors over the lockfile (React 18.0.0, Vue 3.3.0, Svelte 5.0.0), and at what the lockfile installs (React 19.3.1, Vue 3.5.44, Svelte 5.57.3), in the unit tests and the browser suites; the SvelteKit renderer is measured against a component compiled by `svelte/compiler` and rendered by the real `svelte/server`.

<!-- compat-evidence:end -->

## SvelteKit 3 and Nuxt 4

The `sveltekit3` job runs the SvelteKit example migrated to SvelteKit 3.1.1 with
`npx sv migrate sveltekit-3`, and the `nuxt4` job runs the Nuxt example in Nuxt
4.6.3's `app/` layout. Both run on the development server against the mock
admin in Chromium, Firefox and WebKit, and `real-payload-surfaces` drives both
from the real admin in the same three engines. `real-payload-surfaces` also
drives both production builds, and the `production-lifecycle` job builds a
SvelteKit 3 and a Nuxt 4 host from the stored package archive, beside the
SvelteKit 2 and Nuxt 3 ones ([testing.md](testing.md#production-hosts)). The
SvelteKit example needed the migration's changes ([sveltekit.md](sveltekit.md));
the package needed no change for either.
