# ADR 0017 — The Payload config plugin is structural and authorization-free

**Status:** Accepted • **Date:** 2026-09-23

## Context

`buildLivePreviewUrl()` removes the routing boilerplate from
`admin.livePreview.url`, but every project still has to copy the same enclosing
configuration: enable the mapped collections and globals, keep unrelated root
options, and repeat the toolbar breakpoints. Payload has a plugin slot for that
transform.

Payload 2.32.3 and Payload 3.x do not hand the URL callback the same object.
Payload 2 identifies the entity through `documentInfo`; Payload 3 uses
`collectionConfig` or `globalConfig`. Importing either major's `Config` and
plugin types would couple this package entry to that installation and make one
published declaration choose a major.

The transform also sits beside an authorization boundary. A preview query
parameter chooses an iframe URL; it does not prove that the request may read a
draft. A signing secret in a cross-version config helper would be worse:
Payload 2 invokes its callback in the admin browser, while the manual async
token recipe relies on Payload 3 executing it on the server. ADR 0006 keeps
authorization and forwardable credentials at the request-time server gate.

## Decision

### 1. One focused, structural entry

`payload-live-preview/plugin` exports `livePreview(options)`. It returns a
generic `(config: TConfig) => TConfig` transform and imports no Payload package.
Its own small structural types cover only the fields it reads and writes. The
URL helper continues to recognize both callback shapes, preferring Payload 3's
explicit collection/global arguments when present and otherwise reading
Payload 2's `documentInfo`.

The entry is stable. It is configuration code, separate from the runtime
plugins in `payload-live-preview/plugins` and from the framework adapters whose
own setup function is also named `livePreview`.

### 2. Root configuration is the single owner

The transform installs one `admin.livePreview.url` callback built from the
collection/global mappings. It takes a stable union of existing root entity
lists and the mapped slugs: existing order first, then new mapping order, no
duplicates. It preserves unrelated `admin.livePreview` fields.

Breakpoints have replacement rather than identity-merge semantics. Omitting
the option preserves the existing list; supplying it replaces the list with
copied records, and an empty list clears it. There is no reliable cross-version
breakpoint identity beyond the consumer-supplied name, so the plugin does not
invent a per-name merge rule.

The input config is not mutated. Reapplying the same returned transform sees
the callback it owns and is idempotent.

### 3. Existing URL ownership conflicts fail when the transform runs

A pre-existing root `admin.livePreview.url` is an error. A URL on a selected
collection or global is also an error because Payload lets that entity setting
override the root setting. A URL on an unrelated entity remains untouched.

The plugin does not choose a winner among URL owners already present in the
config it receives. A plugin later in Payload's effective execution order can
still replace the callback. Projects make this transform run after other
URL-writing plugins when it should detect their conflict, or combine both
routing policies explicitly.

### 4. Authentication is not an option

The config plugin accepts no signing secret, token issuer, verifier or
request-time hook. `previewParam` remains an intent marker and may be disabled;
it never becomes authorization. A custom name must also appear in the server
adapter's `previewQueryParams`; disabling it needs another intent signal or an
explicit delivery path. The site configures `authorizePreview` at its server
adapter under ADR 0006.

The manual signed-token callback remains outside this entry and is documented
only for Payload 3 when the callback executes server-side. It is not offered as
a Payload 2 recipe. The unresolved entry-to-fragment-to-reload credential
lifecycle is not hidden behind an automatic token option; a scoped server-side
continuation needs its own security decision before the plugin can own one.

## Alternatives considered

- **Type the transform against Payload's exported `Config` and `Plugin`.** This
  gives one installed major stronger inference but makes the public entry choose
  that major. The transform needs only a small common shape, so the coupling
  buys no runtime safety.
- **Write each selected entity's `admin.livePreview.url`.** That duplicates one
  callback, changes more of the consumer's config and makes root/entity
  precedence harder to review. Root lists already enable the same panel.
- **Let the new plugin replace a callback it receives.** That would make its
  position change the iframe destination without a configuration error.
- **Accept a token secret and append a token automatically.** That crosses the
  client/server boundary in Payload 2 and cannot solve the multi-request token
  lifecycle by itself.

## Consequences

- Payload 2.32.3 and 3.x share one tested config transform without either
  package becoming a dependency or peer requirement for the entry.
- Existing root lists and non-URL options compose; breakpoints change only when
  the caller supplies them.
- URL collisions already present when the transform runs surface while the
  configuration is assembled. Writes by a later plugin remain outside its
  reach and are an explicit ordering constraint.
- Payload 3.89 disables native Live Preview during a collection's initial
  create state for both callback and string URLs. It evaluates the shared
  routing callback after the first save.
- Projects that need nullable routes or custom callback composition keep using
  `buildLivePreviewUrl()` from `payload-live-preview/payload`.
- Projects still configure request authorization, draft reads and frontend
  delivery explicitly. Installing the config plugin alone grants no access.

## Addendum (2026-10-03): native collection preview starts after saving

The first real-admin create-state run disproved the string-URL exception
previously documented here. Payload 3.89's Document view passes
`isLivePreviewEnabled && operation !== 'create'` to its preview provider, which
hides the toggle and iframe even when the URL utility produces a fixed string.
The mapped collection delivered unsaved edits after its first save; its create
screen and the manually configured collection's create screen had no preview.
The package keeps the structural URL contract and leaves this native admin
restriction intact. README and the Payload guide now describe that limit.

## Addendum (2026-10-17): the create screen is measured in the repository

The 2026-10-03 observation came from one run against Payload 3.89.0 whose spec
lived outside the repository. The `create` target of the real-admin suite now
repeats it against the 3.90.2 admin that the fixture installed then (3.92.0 since 2026-10-25, 3.92.1 since 2026-10-29), in Chromium,
Firefox and WebKit on every push (`tests/real-payload/surface-create.spec.ts`).
The fixture gives that admin two collections: `mapped-pages`, routed by this
plugin's function, and `manual-pages`, with a fixed string URL.

On the create screen of both, the preview toggle, the panel and the frame are
absent, before and after the editor types. After the first save the toggle
appears. The frame loads `/mapped/<id>?preview=true` for the first collection
and the fixed string for the second, and the editor's unsaved edits reach it
under the owner marker `collection:mapped-pages:<id>` or `collection:manual-pages`.
REST reads before and after show the saved document unchanged and no document
with the typed title.

The reading of Payload's source has not changed: its Document view passes
`isLivePreviewEnabled && operation !== 'create'` to the preview provider, and
`handleLivePreview` evaluates a function-valued URL only when the operation is
not `create`. The suite observes what the first does and not the second.

## Addendum (2026-10-24): one measurement against Payload 4.0.0-beta.4

A consumer project that runs 2.1.0 from npm replaced its hand-written
`admin.livePreview` callback with this plugin and drove the real Payload
4.0.0-beta.4 admin in headless Chromium. Its config type-checks against Payload
4's declarations, and after `buildConfig` the root holds the three mapped
collections, an empty globals list, the plugin's URL function and the two
breakpoints. For six collection documents in two locales the preview frame loads
the URL the hand-written callback produced, apart from the order of the query
parameters, and the breakpoint menu is the same. The resolvers received the
document's locale.

The structural types needed no change for this pre-release. The run happened once,
outside CI, and did not cover globals, the create screen, drafts and autosave,
other plugins that write a Live Preview URL or replacing existing breakpoints.
The decision above still names Payload 2.32.3 and 3.x.
