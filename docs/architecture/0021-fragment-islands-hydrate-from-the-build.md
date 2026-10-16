# ADR 0021 — Fragment islands hydrate from the build, and Astro keeps them

**Status:** Proposed • **Date:** 2026-09-28

This record changes the package: it adds build-owned island resolution to the
Astro adapter and an island handoff to the morph. ADR 0020's page-owned recipe
stays valid; this decision makes the raw fragment path work too.

## Context

A fragment that renders an Astro component containing a `client:*` island
returns an `<astro-island>` the browser cannot hydrate. The native Astro 7.3.2
consumer shows a `component-url` pointing at the application's source file and
a bare `@astrojs/react/client.js` renderer specifier. React never attaches; its
counter does not work. After a second unsaved revision the outer Astro title
changes but the island still shows the first one, because the keyed morph keeps
custom elements whole (ADR 0008 §4). Three native contracts fail in Chromium,
Firefox and WebKit for these two reasons, which are independent.

The maintainer decided on 2026-09-28 that the package solves this instead of
documenting it as a limit. The pinned sources establish the mechanism:

- `experimental_AstroContainer.create()` accepts a public `resolve` option.
  Without it the container returns every specifier unchanged, which is the
  observed source path.
- Astro resolves three specifiers per island: the component, the client
  renderer entrypoint and `astro:scripts/before-hydration.js`. Its production
  pipeline looks each up in the build's `entryModules`, throws for an unknown
  one, returns an empty string unchanged and otherwise builds the public URL
  with the configured `base` or `assetsPrefix`.
- The integration hook `astro:build:ssr` receives that serialized manifest.
- `<astro-island>` observes its `props` attribute and runs its hydrator again
  when it changes. Astro's own router hands new props to a persisted island by
  setting `ssr` and then `props`.
- The React client (`@astrojs/react` 6.0.6) ignores a hydration without `ssr`,
  reuses one root per element and unmounts it on `astro:unmount`.

## Decision

### Build-owned module resolution

The existing `livePreview()` integration records the client entry modules from
the `astro:build:ssr` manifest and converts each to its public URL with the
same `base`/`assetsPrefix` rule Astro applies. It registers these build hooks
in every mode; an application that delivers the runtime itself adds it with
`autoInject: false`. After the build it writes the finite table over a
placeholder in the server chunks, as Astro does for its own manifest. The table
is written as a JSON string and parsed at run time: a plain placeholder literal
was folded away by this package's own minifier; the package check now requires
exactly one fillable placeholder in the packed Astro entry.
`astro dev` has no such table yet; the resolver refuses there with a message
that says so rather than guessing dev-server URLs.

`payload-live-preview/astro` exports the resolver for the container:
`AstroContainer.create({ resolve: resolveIslandModule })`. An application that
renders framework islands in fragments already registers their server and
client renderers on its container; the resolver is the missing third part.

The resolver fails closed. An unknown specifier throws, so the fragment render
fails with the endpoint's generic refusal and a server warning instead of
emitting a source or file-system path. A missing table, because the integration
is not installed or the build was not completed by it, throws an error that
names the integration. Only URLs produced by the build can be returned. No
request field, editor message or response chooses a module.

### The page still owns the island runtime

Fragment responses stay HTML. Their `<script>` elements are parsed into a
template and never run, as ADR 0011 and ADR 0020 require. An inserted island
therefore needs the page to have loaded Astro's island element and the client
directive it uses; the page's finite catalog renders an island with that
directive. When an inserted island is not upgraded, or its directive never
registers, the runtime reports it instead of executing fragment scripts.

### Astro remains the island's owner

The morph still never enters an island. For a live and a rendered
`<astro-island>` it now asks the coordinator whether to retain or replace the
pair. The package rule compares identity: `component-url`, `component-export`,
`renderer-url`, `client`, `opts`, `before-hydration-url` and the island's own
slot markup.

- Same identity: the live island is retained. If `props` differ, the runtime
  applies Astro's handoff: set `ssr`, then `props`. Astro re-runs the
  framework hydrator, and a client that keeps its root, such as React's,
  re-renders with the new props and keeps its state.
- Different identity, slot markup that differs from what the island was last
  rendered with, or an island class that does not observe `props`: the rendered
  island replaces the live one and hydrates fresh. Its state resets, which is
  the honest result for a different component. Astro reads slots once, at
  hydration, so a slotted island seen for the first time may be replaced once.
- An island the morph disconnects receives `astro:unmount` once, the event
  Astro's framework clients use to release their roots.

The island update event (`payload-live-preview:update`) is unchanged. The
handoff is a new optional `MorphOptions` callback (beta). Without it the engine
still keeps every boundary pair whole; the fragment, route and structural
coordinators hand in `retainIslandBoundary` from `islands.ts`, as they already
hand in the boundary rule. That keeps ADR 0008 §9's line between the engine and
the rules it obeys, and a direct `morphElement` caller sees no change.

## Security and resources

Module URLs come only from the build table. The fragment protocol and its
abuse model are unchanged (ADR 0011): the client still sends a registry id and
route, never code or paths. Props reach the island in Astro's own serialized
`props` attribute, produced by the trusted server renderer; the runtime copies
that string and does not parse or evaluate it.

Same-origin component and renderer modules load under `script-src 'self'`.
The inline island bootstrap belongs to the page's build; an application with a
strict CSP hashes it as the native fixture does. No `unsafe-inline`, no fetched
script and no fragment-supplied stylesheet is introduced.

## Scope and limits

Acceptance is measured on Astro 7.3.2, `@astrojs/react` 6.0.6 and React 19.2.8
in a production Node build. Other framework clients and Astro versions use the
same Astro protocol but stay unmeasured until tested; where the island class
does not observe `props`, replacement applies instead of handoff. The
published packages show `create({ resolve })` working from Astro 4.16.19 on
(checked in 4.16.19, 5.18.2, 6.4.8 and 7.3.2); 4.9.0's `create()` drops the
option. Only 7.3.2 is measured natively. Server islands, `astro dev` and
hydration inside non-Astro frameworks are outside this decision.

## Semver, acceptance and rollback

This is a minor change: a new export, integration behaviour, a beta
`MorphOptions` field and a runtime behaviour change. Islands inside morphed
HTML previously kept their first props; they now follow the rendered ones.
A changeset records it.

Acceptance requires the three existing native contracts to pass unchanged in
all three browsers: both cards hydrate, their counters work, the second
revision updates titles and derived values while the counters keep their
state, no CSP violation or module error occurs and content writes stay zero.
Counterchecks: without the table, or for an unknown specifier, the endpoint
refuses without emitting a source path; fragment scripts stay inert; a removed
island unmounts. Unit tests cover the resolver, identity, handoff, unmount and
the diagnostics. `islands.ts` and `morph.ts` are in the nightly mutation scope.

Rollback removes the table, the resolver export and the handoff callback.
Islands then return to being retained untouched, and the page-owned recipe of
ADR 0020 remains the supported path.

## Measured (2026-09-28)

On a source-built archive of this change, the three native contracts that were
red pass in Chromium, Firefox and WebKit, together with the page control, CSP
blockade and navigation cases: 12 of 12. Fragment responses now name the built
`/_astro/` component and renderer modules. Both cards hydrate, their counters
work, and the second unsaved revision updates title and derived value while
each counter keeps its count; the lifetime witness records no remount. There
are no page errors, CSP violations or content writes. With the integration
omitted from the same build, both fragment requests are refused with 500 and
no response carries a source path. Unit tests cover the linking rule, the
placeholder, the fail-closed resolver, identity, handoff, slots, unmount and
`LP0809`; the island tests fail on the previous source for the behaviour, not
only for missing exports. The full nightly mutation scope
(9 464 mutants) passes its policy with 86.03%, 68 uncovered and no errors; the
first run found two uncovered `LP0809` branches, which tests now cover.
