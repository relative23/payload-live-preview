# ADR 0020 — Astro fragment resources belong to the page

**Status:** Accepted • **Date:** 2026-09-27

This decision selects a bounded application recipe, not a new package API.
It extends the resource boundary in ADR 0011 without changing its wire format.

## Observation

The native Astro 7.3.2 production consumer reproduces H05 on the retained
package archive: two initially empty boundaries receive real component markup
and Astro scope attributes, but computed border width is `0px`, not `7px`.
A nested component's letter spacing is `normal`, not `3px`. The isolated
container renders HTML; its success does not supply the page's stylesheets.
The failing browser assertion and asset hashes are retained with the hardening
evidence. This is an integration gap, not evidence of code execution.

## Decision

The application owns a finite, statically imported component catalog. The page
renders that same catalog even when its current data produces no component
markup. The fragment registry uses it too. Astro can therefore include the
catalog's compiled scoped CSS in the page build before its first unsaved use.
No hidden sample content, copied scope hashes or dynamic import names are
accepted as registration.

The page owns stylesheet lifetime and deduplication, including navigation by
Astro's ClientRouter. Removing one preview owner must not remove resources
that another boundary on the page may need. Leaving the page transfers resource
ownership to Astro's router. The preview element separately owns the packed
client, pending requests and subscriptions; disconnect destroys that client.

For the strict-CSP reference, `build.inlineStylesheets: 'never'` keeps CSS in
same-origin external assets allowed by `style-src 'self'`. Fragment responses
remain HTML only. No styles, scripts, external resource URLs or executable
module names are accepted from form data; the sanitizer is unchanged.

The reference also provides its live region before mounting the client, with
external scoped CSS. The existing announcer adopts it and remains enabled.
The browser probe caught `style-src-attr` when the package created its fallback
region with an inline style. That default is unchanged by this recipe and
remains a strict-CSP integration limitation; do not hide it by disabling
announcements or adding `unsafe-inline`.

The custom container renderer derives its request URL, params and narrowly
typed locals from the current verified authorization. Browser-provided locals,
headers or asset selectors do not become renderer context. Per-request data is
never stored in the shared container. Existing configured-renderer overrides
remain available; this recipe does not claim that arbitrary framework children
hydrate after a fragment morph.

## Alternatives and limits

A manifest-driven adapter could load newly discovered resources. It would
need a versioned manifest, trusted URL policy, CSP/integrity decisions,
reference counting, failure semantics and native navigation integration.
There is no second required consumer for that new API in this charge. Prefer
the page's existing resource graph until a measured use case cannot use a
finite catalog.

Putting styles or scripts into fragment HTML would cross the current trust
boundary. It is rejected. Manually copying generated selectors would couple
the page to unstable build output and is also rejected.

The cost is eager CSS for the declared catalog, including currently absent
components. Measure emitted assets and public bytes; do not call this on-demand
loading. Components outside that graph, remote assets, arbitrary providers,
additional framework hydration and exact Astro 4–6 feature floors remain
separate contracts. No supported framework family or version range is removed.

## Acceptance and rollback

The native archive consumer must check real and deliberately invalid Astro
templates, then run an optimized build. Browser acceptance requires first and
second unsaved revisions with computed scoped styles, nested component CSS,
deduplicated resources, strict CSP, retained visitor state and no content writes.
Concurrent authorized requests must keep their contexts apart. Destroy/remount
and native page navigation must reject late work and release the old owner.
Source-level renderer/sanitizer tests supplement, not replace, those checks.

Rollback removes the application recipe, resource-profile fixture, independent
dependency lock, tests and runner branch. Product sources, exports, defaults,
budgets and the retained archive are unchanged; no package changeset is needed
for this test-and-documentation charge. The hardening records retain failed
attempts and do not close H05 beyond the measured recipe.

## Exact-version follow-up (2026-09-27)

The same recipe now passes nine native cases per version on Astro 4.16.19,
5.18.2, 6.4.8 and 7.3.2 in Chromium, Firefox and WebKit. Astro 4 uses
the `ViewTransitions` export; later versions use `ClientRouter`. Compiled
catalog rules and hashes identify the stylesheet, not a version-specific
chunk name. These results extend the recipe evidence, not the package API.

Exact Astro 4.9.0 is different: its Container types and implementation lack
`props`. A native production consumer of the installed default endpoint
returns HTTP 200 without the requested unsaved card/title (PHD-04, P1).
The current [Container reference](https://docs.astro.build/en/reference/container-reference/)
describes current APIs and warns that this experimental API can change; it
does not establish historical option support. Keep the floor visibly red.

A public request/locals-based typed catalog wrapper is the recommended next
application recipe for 4.9.0. Its acceptance needs the full context/resource/
lifetime contract, and it must not be presented as repairing the default
renderer. No private Astro internals, new public API, silently raised minimum
or product patch is authorized by this evidence follow-up alone.

## Astro 4.9.0 application renderer (2026-09-27)

Select the existing explicit `render` override for the finite catalog. A
statically imported `.astro` wrapper reads a narrowly typed request-local
catalog value and passes it as normal component props to `Blocks`. The
renderer supplies that value through the public Container `locals` option,
together with the previously verified request URL, params and authority
context. It does not use the absent Container `props` option or private
component-factory hooks. The page still owns the same catalog's compiled CSS.

The fixed registry is the only component selector. The renderer validates
the registry component identity and the catalog's boolean, text and bounded
delay fields. Neither arbitrary locals nor code/import/asset names are taken
from browser input. Each call owns fresh context objects; the reusable
container stores no application request state. Missing catalog data fails
explicitly instead of rendering an empty successful revision.

Keep this recipe opt-in in the native fixture and retain the separate default
4.9.0 reproduction. Acceptance requires the same strict template countercheck,
native production archive, computed styles, two unsaved revisions, verified
concurrent context and owner/navigation cleanup in three browsers. A working
recipe does not close PHD-04's default-renderer defect. Rollback removes only
the wrapper/renderer overlay and fixture selection, not supported versions or
package security controls. There is no new public package API or changeset.

The explicit locals recipe now passes all nine native cases on exact 4.9.0
and on 7.3.2. Forged form fields include both the authority locals and the
catalog value; neither reaches rendered output. The unchanged default remains
separately selectable. Inspecting the integrity-pinned 4.9.0 implementation
confirms that its public render options are slots, request, params, locals and
routeType, with no props channel. A cast or private factory hook is not a fix.

A package-provided `.astro` bridge is a candidate for a separate decision, not
an implementation authorized by this recipe. It would need a native compiler
and package-resolution contract, optional-peer isolation, ESM/CJS checks and
the same packed default-path regression. Whether that bridge can remain
internal or needs a public entry is unproven. Keep PHD-04 open until a reviewed
product contract and the actual installed default satisfy the unsaved revision.

## Default bridge feasibility boundary (2026-09-27)

The next experiment is confined to a derived, private test archive. Start
from the pinned retained archive and replace only its exact known default
render expression with a literal, lazy relative import of an internal
`.astro` template. The template uses normal dynamic component syntax and
fresh Container locals to pass the registry-selected component and props.
Runtime validation rejects a missing bridge value. Browser data never chooses
an import, function or template. No private Astro runtime factory is used.

The experiment must first demonstrate that native Astro actually compiles
that internal template when reached through the package's JavaScript entry.
A successful package import does not prove that deferred render import works.
If Vite externalizes the package and Node receives an uncompiled `.astro`
file, retain that failure before testing an explicitly configured build path.
Do not silently add a build requirement to the product default.

Public exports, optional-peer metadata and all unrelated entries must stay
identical in the derived archive. Check root ESM/CJS and the Astro ESM entry
without installing Astro; `./astro` has no require condition to invent.
The unchanged retained default stays a separate red control. An experimental
archive with an edited bundle is not a release candidate or source-level fix;
its source map cannot be presented as regenerated package output. Any shipping
solution must later be implemented in source and rebuilt through the complete
package pipeline. No new entry or product semantics is selected here.

## Default bridge experiment and next patch (2026-09-27)

The private derived archive now passes the selected default-renderer contract
on exact Astro 4.9.0, 4.16.19, 5.18.2, 6.4.8 and 7.3.2: nine cases per version
in Chromium, Firefox and WebKit. Native production builds compile the literal
lazy internal `.astro` import without extra consumer build configuration.
The endpoint uses no application `render` override. Two unsaved revisions have
the selected text and computed scoped/nested CSS; concurrent registry props,
scope refusal and actual abort/remount/navigation also pass.

Each prototype consumer checks the exact installed template in its native
semantic checker and rejects an intentional TS2551 counterexample. That local
checker copy is removed before the production build, which must resolve the
packed internal template. The archive retains public exports and optional
peer metadata. A separate peer-free consumer imports root ESM/CJS and Astro
ESM and runs a custom renderer. Astro's require condition remains absent.

This establishes a feasible internal bridge, not a completed product fix.
The source map in the experimental archive is stale and the unchanged retained
default remains the regression control. PHD-04 stays open. The bridge transports
registry-selected component props only; it does not supply verified page URL,
params, authority locals, extra renderers or resource discovery. Existing
explicit-context recipes keep their separate acceptance cases.

The next patch should implement this bridge in source, keep its import literal
and lazy, and copy the internal asset through `build:assets`. The package
bundler must leave only that asset import for the native consumer compiler.
Use a narrow internal type contract; do not add a permissive wildcard or new
public entry. Cover missing/invalid bridge data, concurrent calls, peer absence,
custom-render laziness and the packed default regression. Preserve existing
authorization, sanitization and page-owned resource contracts.

Treat restoration of component props on the advertised floor as a patch fix
with a changeset, not a new default mode. Rebuild through the normal pipeline
so source maps and asset inventory are real; measure affected budgets and run
the package, native and applicable mutation gates. Rollback removes only this
source bridge and build wiring. Additional provider/hydration support and the
live-region fallback are separate decisions, not part of this patch.

## Source-level default correction (2026-09-27)

The implementation keeps the measured bridge internal. `fragments.ts` lazily
loads the optional container first, preserving its missing-peer diagnostic,
then the literal `./FragmentBridge.astro` import. Both immutable loaders share
initialization; every render receives fresh locals containing only the
registry-selected component and its props. An explicit renderer loads neither
default dependency. A failed component render does not poison initialization.

`build:assets` copies the template verbatim. The bundler externalizes that
exact relative asset, and a sibling declaration describes only that internal
import. There is no wildcard declaration, new public export or mandatory Astro
installation. The package gate now requires the asset in both the archive and
the installed consumer; native Astro checks and compiles the real template.

The bridge rejects missing or malformed internal data instead of reporting an
empty successful render. A local-only native endpoint checks eight invalid
values and normal escaped component text without accepting request input.
This supplements the public endpoint's existing registry/auth/limit tests; the
internal guard is not a substitute for authorization.

The patch changes only the default props transport. It does not forward the
fragment request as page context, register extra framework renderers, discover
resources or change sanitizer/announcement policy. Those existing boundaries
and the explicit verified-context recipes remain. A patch changeset records
the restored behavior. Rollback removes this source bridge, its build wiring
and measured entry-budget delta together, retaining the historical regression.
The original private prototype remains an experiment, never a release asset.

The architecture gate now includes the three shipped Astro templates, not a
non-source import exemption. Their frontmatter and template expressions use
a strict TSX-compatible representation; unsupported syntax fails closed.
Native Astro semantic checks and production compilation remain the template
authority. The graph measures 262 modules instead of 259: one new bridge and
two existing exported templates newly counted. The budget records that exact
difference. Public declarations and entry counts do not rise.

## Additional React renderer boundary (2026-09-27)

Use one separate exact-lock application consumer: Astro 7.3.2, Node adapter
11.1.4, Vite 8.1.4, React/ReactDOM 19.2.8 and `@astrojs/react` 6.0.6.
The existing Astro-only consumer and package archive remain unchanged.
The [public Container API](https://docs.astro.build/en/reference/container-reference/)
requires explicit runtime renderer registration. The pinned integration exports
`@astrojs/react/server.js`; register its named renderer with
`container.addServerRenderer({ renderer })` in the application's existing
`render` override. No package API, automatic peer loading or browser-selected
renderer is added.

The native counterexample keeps that integration installed and enabled for the
page build but omits registration in the fragment container. Its production
build and semantic controls succeed; the actual two fragment responses return
500 without either requested card. This distinguishes a container configuration
gap from a missing dependency. The configured run must change only the trusted
deployment selection, not form data, auth, sanitizer or browser assertions.

The statically imported React child receives presentation props and an explicit
request-local authority value from its Astro parent. Its own React provider is
created per render; it does not inherit a provider from an unrelated page root.
The page's finite catalog owns the emitted CSS. No fragment supplies scripts,
stylesheets or client module URLs.

React server rendering is not hydration. A separate page-owned positive control
hydrates the same component with React's public `hydrateRoot`, from a compiled
external module, and disposes that root on disconnect. Its committed effect and
working counter must be observed. The fragment's static HTML must not be claimed
as interactive just because it contains a button or a successful render event.
This control is not an Astro `client:*` or post-morph hydration implementation.
Those contracts remain separate H05 work and require a resource/ownership
decision before changing the product.

Acceptance requires consecutive unsaved React text and derived values, computed
CSS, concurrent provider isolation, strict CSP, zero content writes and native
owner/navigation cleanup in all three browsers. Keep the unconfigured failure,
strict Astro/React semantic counterchecks and normal Astro-only neighbors.
Rollback removes this consumer and test recipe only; there is no product source
change or package changeset in this bounded unit.

## Native island characterization boundary (2026-09-27)

Characterize native `client:load` separately from the manual React root above,
using the same exact dependency lock and package archive. Keep a desired-behavior
test genuinely failing when the contract is not met; a characterization of old
behavior is not a fix. Register the container's server and client renderers
through the public Container API, never its private manifest constructor.

The initial native control is blocked by the fixture's existing self-only CSP:
Astro emits two inline bootstrap scripts and an inline island style. The next
fixture-only policy may allow their exact SHA-256 hashes, obtained from a fixed,
prerendered build page with no request or CMS data. Validate the pinned resource
count and fail closed on a different build shape. Do not hash arbitrary response
HTML, allow `unsafe-inline` or `unsafe-eval`, or trust resource declarations from
editor messages. Keep a blocked unlisted-script/style countercheck. This is a
measured application policy for this build, not automatic package CSP support.
Astro's separate meta-CSP feature is not substituted for the existing header or
used to claim untested ClientRouter compatibility.

The fragment strategy parses trusted endpoint HTML into a template and morphs
it; it does not call the rich-text sanitizer. The registered server renderer
owns escaping and the component/resource selection. Record the actual emitted
island elements, module references and bootstrap content, and distinguish inert
script elements from custom-element upgrades. Do not infer script execution,
successful hydration or a security vulnerability from HTML bytes alone.

Observe first insertion, consecutive unsaved revisions, working counters and
effect cleanup. Existing custom-element boundaries retain their subtree, so
measure the React-rendered revision rather than accepting the outer Astro title
or refresh event as proof. Keep page ownership, authorization, CSP, cancellation
and native router disposal active. Product ownership or resource policy changes
require a separate decision after these observations; rollback of this unit
removes only its isolated fixtures and tests.

## Next application-owned renderer (2026-09-27)

The native page control proves that this exact build can hydrate React under
the explicit CSP. The separately created container does not produce a browser
module mapping merely because server and client renderers were registered.
Its returned island also has no application listener that commits the next
revision. Fixing one of those boundaries would not prove the other.

For the next bounded recipe, prefer a finite native React island already owned
by the page. Import its code and resources at build time and use the existing
island update event to supply authorized presentation fields. React owns the
first newly visible branch and later keyed renders. Test actual committed
revision, derived output, retained state, pre-hydration delivery, two-owner
isolation and real native cleanup before claiming this recipe works.

Do not select the private container manifest constructor: it couples the
application to unreviewed internals. Recreating a React root after every morph
would discard visitor state and compete with the boundary owner; it is not a
default fix. A general resource loader is a larger public contract and must
not be introduced by this fixture. Keep the raw native-container reproduction
red until that distinct contract is implemented. No framework family is
removed, and no product default or semver decision changes in this recipe.

### Bounded recipe ownership

The application imports two native `client:load` React catalog roots on the
authorized page, outside its separate Astro fragment boundaries. Their initial
visible branch is absent. The page supplies immutable document, locale and
provider identity; the update event supplies only selected presentation fields.
Module names, resource URLs and authorization claims in fields have no consumer.
The ordinary fragment endpoint remains independently authorized and Astro-only.

The initial recipe registers its listener in React's layout effect. This must
not be assumed to precede Astro's hydration marker removal. Observe the existing
package replay by delaying the real compiled
component request; do not synthesize an Astro hydration event or resend the
snapshot. React's committed DOM, not receipt of the event, decides acceptance.

The application custom element owns the packed client. A same-task DOM move
keeps that lifetime. A real detach stops it and signals the local React
listeners to abort pending application work; reattachment starts a new local
revision epoch without replacing the React roots. Native router unmount owns
final React disposal. These local attachment signals are application glue,
not new package events. A bounded asynchronous formatting job countertests
supersession and cancellation; it is not a server authorization mechanism.

Keep the exact dependency lock, fixed-build CSP hash policy and raw-container
red test. This fixture has no public API or semver effect. If native hydration
or package replay violates the required order, retain the failure and stop for
a separate product regression and patch decision.

### Recipe counterexamples: PHD-05 and PHD-06

The mixed page fails before the recipe's remaining lifetime work can be
accepted. Without an ordinary outer patch, fragment planning leaves pending
work, so the pipeline's no-work island notification is skipped. Fragment
completion updates its counters and emits its own events, but does not notify
the islands. A ready React root remains at revision zero while both Astro
fragments show the new title. The direct-source four-case test uses the actual
runtime and fragment HTTP client: both no-fragment controls pass and both
fragment cases fail. This is PHD-05, a P1 product correctness bug; adding a
dummy patch binding would conceal it, not fix it.

Independently, delaying the real compiled React component exposes PHD-06.
Without fragments, the package emits the retained revision after `ssr` leaves,
but before either React layout-effect listener attaches. The native
`astro:hydrate` event and both update events observe `data-ready="false"`.
The installed `@astrojs/react` 6.0.6 client schedules `hydrateRoot` inside
`startTransition`; Astro's awaited hydrator return does not await that React
commit. A JSDOM test that installs a listener before manually removing `ssr`
cannot establish the native ordering. This is a P1 integration gap, not a
claim that React's documented API is broken.

Stop the application recipe at these counterexamples. First fix PHD-05 as a
bounded compatible core patch, preserving revision, cancellation and owner
guards without duplicate notifications. Then prefer a finite application-owned
latest-snapshot store subscribed before runtime start, with an explicit React
subscription/initial read, over a guessed timeout or framework-private hook.
That PHD-06 recipe needs separate lifetime and native tests; a new public
readiness API would need a separate minor-version decision. Neither approach
is implemented or verified by this characterization. The raw-container red
contract remains independent and unchanged.

### PHD-05 correction boundary

The core now hands a snapshot to islands even when only fragment work is
pending. Its completion counter still waits for the actual work. A weak
per-snapshot target ledger prevents duplicate events from subsequent fallback
flushes, and the handoff rechecks current revision, cancellation and owner
scope. ADR 0004 section 7a owns that timing contract. No dummy patch binding,
new export, resource loader or hydration signal is introduced.

The source regression must pass before building a new archive. Native mixed
page acceptance must use that archive with the existing React effect recipe
unchanged. Only afterwards may PHD-06 change the application subscription, so
the two corrections have separate before/after evidence. Delayed module tests
and the raw-container contract remain genuine failures until their respective
contracts are fulfilled. A PHD-05 patch changeset does not claim a hydration fix.

### PHD-06 application handoff

The page installs one event listener per statically declared native island
before starting its packed client. A weakly keyed channel retains only the
latest selected presentation: title, visibility, revision and a fixed test
formatter mode. Document and locale must match the page's immutable identity;
authority objects, module paths, resource URLs and other fields are not retained.
Nested owners are excluded. This is a finite page catalog, not discovery of
arbitrary islands or an authorization store.

React's layout effect subscribes to that channel, then reads its latest value.
An event on either side of native hydration therefore has the same consumer.
Only React sets its state and writes its subtree. Neither Astro marker removal
nor package completion becomes an acknowledgement of that React commit. No
readiness timeout, editor resend, private framework hook or new package event
is needed. The native regression still holds the real emitted component module
until the package finishes the unsaved revision.

Each page attachment gets a new store lease. Stopping it removes ingress and
clears snapshots without allowing an obsolete lease to clear a replacement.
React unsubscribes and aborts pending application work on owner stop; remount
starts a fresh local revision epoch. Supersession, stop and reentrant movement
are checked during fanout. A same-task DOM move preserves the owner and keyed
visitor state; final native navigation remains responsible for React unmount
and page resources. This local store is neither persistent preview data nor
server authority, and does not outlive its page owner.

Acceptance requires the unchanged PHD-05 archive, actual delayed-module React
commits, latest-only replay, asynchronous cancellation, concurrent provider
isolation and native move/detach/remount/navigation checks in three browsers.
The raw-container counterexample remains separate. Rollback removes the store,
its React subscription and their tests together; it must not remove PHD-05's
compatible core correction. This application recipe has no package semver or
migration effect and does not expand the measured renderer/version range.

## Raw fragment islands (2026-09-28)

The raw-container contract this record kept red is decided in
[ADR 0021](0021-fragment-islands-hydrate-from-the-build.md): the fragment
container resolves island modules from a table the build writes, and Astro's
own props handoff carries later revisions. The page still owns the island
runtime and the catalog's CSS, and no module name or resource URL enters the
fragment protocol. The page-owned recipe above remains valid for islands the
page renders outside its fragments.
