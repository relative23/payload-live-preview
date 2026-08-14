---
'payload-live-preview': patch
---

Make live-preview updates revision-safe, discard stale asynchronous work across lifecycle generations, and report only DOM changes that were actually applied.

Apply plugin transforms consistently, restore layered renderers on teardown, and release every listener, transform, renderer, and cleanup registered through a plugin context. Harden Payload message, merge-path, CSP, and preview-boundary validation while clarifying that preview intent is not authorization.

Isolate shared accessibility resources across clients while preserving adopted consumer DOM, make binding-cache updates atomic, observe all binding metadata, and keep consumer diagnostics from interrupting event dispatch, updates, fallbacks, or teardown. Apply structural-array DOM changes synchronously so completion events describe real writes and destroyed clients cannot receive deferred transition callbacks. Preserve literal template values, including JavaScript replacement metasequences, and support injected sanitizer documents in Node without browser globals.

Reconcile SSR-seeded structural arrays without duplicate children, keep mixed keyed moves and updates in final-data order, refresh top-level and nested template metadata, and preflight the complete nested tree so invalid deep markup cannot partially mutate live DOM. Create structural roots through their container document. Built-in no-write paths no longer emit successful update events, while existing custom renderer and scheduler callback return values retain their 1.x semantics.

Roll back partial runtime startup across observers, message listeners, caches, accessibility leases, ready timers, and inline global-handle publication so transient browser failures can be retried on the same runtime or client; contain later ready-retry transport failures.

Make timers, animation frames, observers, message listeners, accessibility nodes, and merge attempts retain exact ownership across ineffective cancellation and re-entrant host callbacks. Stale callbacks can no longer clear or publish newer work, and hostile or asynchronous consumer callbacks remain fail-soft without escaping as unhandled rejections.

Keep consumer installs free of package lifecycle build scripts, preserve the established 1.0.x inline-runtime presence marker, and add isolated strict exact-tarball, export, CLI, type, bundle, and release-after-CI gates that cannot inherit maintainer dependencies; remove unreachable CommonJS artifacts and redundant built-in registrations.

Minify the narrow `core` entry independently while retaining every callable public export name, declaration, source map, and ESM/CJS condition; the bundle gate now verifies that full callable namespace instead of a hand-picked subset.

Turn the test environment into an executable quality contract: fail on flaky, skipped, focused, conditional, retried, repeated, or stale-inventory tests; ratchet global, critical-file, and changed-line coverage; enforce dependency layers, cycles, dead code, immutable workflow actions, and exact release-job requirements. Validate the exact package archive with API Extractor reports, positive and negative NodeNext type contracts, publint, ATTW, declaration-condition parity, isolated consumers, and a reviewed public-type-debt ratchet.

Promote the exact CI-verified npm archive instead of rebuilding at publish time. Bind it to a reproducible commit timestamp and a digest/content manifest, recheck the downloaded workflow artifact, and verify the registry-served bytes before creating the release tag.

Add Stryker mutation profiles and deterministic fast-check security/lifecycle models, including scheduled high-volume exploration. Add CodSpeed trend collection, WCAG 2.2 AA Axe checks, a 10,000-update forced-GC Node resource gate, and a sustained Chromium update/heap soak, with all expensive exploratory checks separated from the deterministic pull-request lane.
