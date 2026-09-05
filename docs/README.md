# Documentation

## Reading path

1. **What is this** — the [README](../README.md): what the package does, where it fits next to the official hooks, install, the Payload side.
2. **Your framework** — [Astro](astro.md) · [Next.js](nextjs.md) · [SvelteKit](sveltekit.md) · [Nuxt](nuxt.md) · [Plain HTML](html.md). Each guide goes from install to a working preview and names its runnable example.
3. [bindings.md](bindings.md) — every `data-payload-*` attribute, the field types, owners for pages with several documents, typed bindings and `pll-codegen`.
4. [options.md](options.md) — the package entries, every option with its default, `defaults: 'v1'`, Payload 3.x population with `serverURL` and `mergeDepth`.
5. [authorization.md](authorization.md) — why intent is not authorization, the `payload-session`, `signed-token` and `verifier` strategies, signed preview URLs, the initial draft read with `definePreview()`.
6. [hybrid.md](hybrid.md) — the patch, fragment and route strategies, the fragment endpoint, islands on the same page.
7. [deployment.md](deployment.md) — CSP and nonces, caches and proxies, what a production deployment must and must not do.
8. [troubleshooting.md](troubleshooting.md) — `inspect()`, `pll doctor`, every diagnostic code and what to do about it.
9. [security.md](security.md) — the layered defenses and how to disclose a vulnerability.
10. [migration.md](migration.md) — from every earlier version, and `pll migrate`.

Related: [renderers.md](renderers.md) (events, transforms, renderers, plugins), [reveal.md](reveal.md) (follow the edited field), [interop.md](interop.md) (running both this package and the official hooks).

## For maintainers

- [testing.md](testing.md) — the test tiers, local commands, coverage and mutation policy.
- [benchmarks.md](benchmarks.md) — hot-path timings, update-to-paint, tree shaking.
- [architecture/README.md](architecture/README.md) — the architecture decision records.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — development setup, project layout, the checks a change must pass.

## Glossary

- **Preview intent** — the request asks for a preview: a query parameter (`preview`, `draft` or `livePreview` set to `true` or `1`) and, when configured, `Sec-Fetch-Dest: iframe` or an admin referer. Client-controlled; never authorization.
- **Authorization** — the verified context `authorizePreviewRequest()` produces for a request it accepts. The adapters publish it as `livePreviewAuthorization` on `Astro.locals`, SvelteKit's `event.locals` and Nuxt's `event.context`.
- **Outcome** — the string in `livePreviewAuthorizationOutcome`: `'authorized'`, or the reason for a refusal (`'missing-credential'`, `'expired'`, `'wrong-audience'`, …).
- **Binding** — an element carrying `data-payload-field`; the runtime patches it in place.
- **Empty-field anchor** — a `data-payload-boundary` element rendered while the field is empty and kept hidden until a value arrives, so an edit has somewhere to land.
- **Fragment boundary** — a `data-payload-fragment` subtree the server renders from the unsaved form state and the runtime morphs in.
- **Strategy** — how a binding is updated: `patch` (in place), `fragment` (server-rendered boundary) or `route` (whole-route refresh).
- **Runtime** — the script that listens to the admin: the inline script the adapters inject, or `LivePreviewClient` when you start it yourself.
