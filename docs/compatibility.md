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

**Payload 2.x** is not supported. The 2.x line of this package is the one for
Payload 2: this release applies nothing of an admin that sends `fieldSchemaJSON`,
which only Payload 2 does, and reports `LP0504` when it refuses
([ADR 0007 ledger, entry 25](architecture/0007-v2-defaults-and-renames-ledger.md#ledger),
[Preparing for 3.0](migration.md#preparing-for-30)).

The manifest declares `payload` as an optional peer,
`^3.0.0 || ^4.0.0-0`: npm never installs it, and a project that has
Payload outside that range gets npm's `ERESOLVE` error.

### What differs between Payload 3 and 4

|                                  | Payload 3.x                      | Payload 4.x (pre-release)                                                   |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| Scalar field updates             | ✅                               | ✅                                                                          |
| Rich text (Lexical)              | ✅                               | ✅ through a fragment render (beta.4) and the client-side renderer (beta.6) |
| Relationship / upload population | ✅ with `serverURL` (REST merge) | uploads ✅ with `serverURL` (beta.6); relationships not measured yet        |

Neither sends field types: a binding's type comes from the page
(`data-payload-type`, the element) and from the shape of the value, such as a
Lexical root.

## What runs against each version

<!-- compat-evidence:start -->

On every push:

- Payload 3.94.2: every adapter's example runs against the real admin, `examples/payload-backend`, in Chromium, Firefox and WebKit.
- Payload 3.85.0, 3.88.0, 3.89.0, 4.0.0-beta.4, 4.0.0-beta.6: the messages a real admin of each version sent, captured once and replayed in `tests/integration/wire-corpus.test.ts`.

Every day:

- Payload latest: the protocol watch runs `@payloadcms/live-preview@latest` against the captured messages, and the real-admin suite against `payload@latest`.
- Payload 4.0 pre-releases: the same against `@payloadcms/live-preview@beta` and `payload@beta`; a failure there warns and does not gate a release.

Outside CI:

- Payload 4.0.0-beta.6: on 2026-11-02, the 7 cases of `tests/real-payload/surface-findings.spec.ts` passed in Chromium, Firefox and WebKit against the admin fixture with beta.6 installed over it (Node 24.22.1); an upload reached an `<img>` inside a `<picture>` through the REST merge, and a Lexical edit was written by the client-side renderer, internal link included. Relationships were not part of the run.
- Payload 4.0.0-beta.4: on 2026-10-24, in a consumer project on 2.1.0 (Next.js 16, Node 24), the config plugin type-checked against Payload's declarations and passed its config sanitizing; for six documents in two locales it built the URL a hand-written callback produced, apart from the order of the query parameters, and the locale reached the path resolvers; the `payload-session` strategy authorized against an admin with a `csrf` list once its `origin` option was set. Globals, the create screen, drafts and autosave, other plugins that write a Live Preview URL and replacing breakpoints were not part of the run.
- Payload 4.0.0-beta.4 with Astro 7.4.2: on 2026-10-26, a 2.2 release candidate on a consumer site: typing into a title and a text line patched the preview, typing into a rich-text field updated it through 7 fragment renders that answered 200, the frame never reloaded, and all 31 messages had the shape of the captured ones. Relationships and uploads were not part of the run.

Every version in the README's framework table is what the fixture lockfile or the matrix job installs, checked by `npm run compat:check`.

Of the 49 feature rows of `quality/compat-matrix.json`, 10 passed in the CI run the last Version PR recorded (commit `6367809`, 2026-11-24, `quality/compat-results.json`); the other 39 have no recorded result.

Vite 8: that is what the supported framework majors install (Astro 7 → 8, SvelteKit 3 → 8, Nuxt 4 → 8), measured 2026-11-27. `npm run compat:check` keeps the devDependency and the fixture lockfiles inside that span; `npm run compat:refresh` re-reads it from the registry.

The framework hooks and fragment renderers run twice on every push: at the floor of each peer range, as unit tests in jsdom that the `hook-matrix` job runs after installing the floors over the lockfile (React 18.0.0, Vue 3.3.0, Svelte 5.0.0), and at what the lockfile installs (React 19.3.1, Vue 3.5.46, Svelte 5.59.1), in the unit tests and the browser suites; the SvelteKit renderer is measured against a component compiled by `svelte/compiler` and rendered by the real `svelte/server`.

<!-- compat-evidence:end -->

## Nuxt

The `e2e` job runs the Nuxt example, in Nuxt 4's `app/` layout, on the
development server against the mock admin in Chromium, Firefox and WebKit, and
`real-payload-surfaces` drives it from the real admin in the same three
engines, its production build included. The `production-lifecycle` job builds
a Nuxt 4 host from the stored package archive
([testing.md](testing.md#production-hosts)). Nuxt 3 reached its end of life on
31 July 2026 and left the suite with 3.0: nothing runs against it.

## SvelteKit 2

SvelteKit 2 is no longer tested. Its release line carries a high-severity
advisory that is patched only in SvelteKit 3.1.1
([GHSA-3r8g-jcqq-3p5j](https://github.com/advisories/GHSA-3r8g-jcqq-3p5j)), so
the SvelteKit example and every job that installs it run SvelteKit 3. The
adapter's code is the same for both majors and did not change; a SvelteKit 2
project keeps working as far as that code goes, without a job that proves it
([sveltekit.md](sveltekit.md)).
