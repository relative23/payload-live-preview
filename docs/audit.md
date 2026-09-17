# Audit: the trusted core

This page is for someone deciding whether to let this package touch a page
they are responsible for, with an afternoon to decide in. It names the part of
the package that decision rests on, says how big it is, walks through it in
reading order with every invariant named, and says which gate holds each one.
What the package _is_ — two screens, one message, five objects — is in
[architecture/overview.md](architecture/overview.md); this page does not repeat
it.

## What you are trusting

A page that carries this runtime accepts three things it would otherwise not:
messages from another window, a request to the CMS with the visitor's cookies,
and writes into its own DOM from values nobody validated. Everything the
package does that matters to a page's owner is one of those three, so the
questions to answer are three as well:

1. **Who may speak to the page?** The bus that listens to `postMessage` and
   the shape guards it consults.
2. **What may be written?** The attribute write, the sanitizer, and the escape,
   URL and Trusted Types primitives it rests on.
3. **What leaves the page, and with what?** The merger that re-fetches an
   update through the CMS's REST API with `credentials: 'include'`.

The modules that answer them are the **trusted core**:

| Module                          |     Lines | Decides                                                                        |
| ------------------------------- | --------: | ------------------------------------------------------------------------------ |
| `src/core/message-guards.ts`    |        95 | which shapes are a message at all                                              |
| `src/core/message-bus.ts`       |       386 | which window may send, in which order verdicts commit, when a callback may run |
| `src/core/data-merger.ts`       |       202 | the one request that carries cookies: to where, with what, and which one wins  |
| `src/core/attribute-binding.ts` |        68 | which attribute a remote value may become                                      |
| `src/security/url-validator.ts` |        44 | which URL is a URL                                                             |
| `src/security/escape.ts`        |        48 | how text becomes markup without becoming markup                                |
| `src/security/sanitizer.ts`     |       445 | which tags and attributes CMS content keeps                                    |
| `src/security/trusted-types.ts` |        68 | the one policy every HTML sink goes through                                    |
| **Total**                       | **1 356** | 1 032 without blank and comment lines; 41 exported names                       |

The boundary is not a feeling about which files are important. A module is in
the core because it **holds a capability**: it listens to messages, sends a
credentialed request, creates the Trusted Types policy, or writes a wire value
into an attribute — read off its syntax by `scripts/architecture-capabilities.ts`
the same way the layer rules read its imports. Modules that hold a capability
and stay outside are listed in
[quality/trusted-core.json](../quality/trusted-core.json) under `outsideCore`,
each with the reason: the fragment and route strategies fetch the page's own
origin, the renderers write only what the sanitizer or the escape helpers
produced, the bootstrap loads a URL baked in at build time, the server-side
authorization never reaches a browser at all. A module that holds a capability
and is listed nowhere fails the build.

### The three gates

**1. The core cannot grow.** `scripts/check-trusted-core.ts` counts the eight
modules the way `wc -l` does and holds the total at the number in
`trusted-core.json` — the exact measurement, no headroom. A line added to the
core is a line every reader has to trust, so adding one means raising the
number and writing down why, next to the number. The same file lists the five
modules the core imports from outside itself (the field-schema parser, a
diagnostic wrapper, a thenable guard, the protocol version constant, one
warning); a sixth fails until it is reviewed too.

**2. Nothing outside the core can do what the core does.** The capability rule
in `scripts/architecture-rules.ts` holds every module to the capabilities the
policy lists for it, exactly. Three capabilities — the message listener, a
request with `credentials: 'include'`, the Trusted Types policy — cannot be
held outside the core with any reason. Below the module, `scripts/sink-rules.ts`
holds every site: each `innerHTML` assignment is in
[scripts/sink-inventory.ts](../scripts/sink-inventory.ts) with one of four
justifications (sanitised, escaped, parsed into an inert template, the page's
own server render), each attribute write that names a URL-bearing attribute or
`style` or computes its name is there with one of five, and a handler, `srcdoc`
or `formaction` cannot be written by name at all. A `fetch` that appears in a
renderer is a red build, and so is a justification whose site has moved.

**3. The core's tests notice a changed line.** A Stryker profile mutates the
eight modules and nothing else (`STRYKER_SCOPE=core`), with every mutant killed
as the target. The measured score is in
[quality/mutation-policy-core.json](../quality/mutation-policy-core.json):
1 202 mutants on 2026-09-11, 99.17 % killed, 10 survived and none left
unexecuted by a test, 13 minutes. 2.0.1 adds ten in the sanitizer's `name`
check for LP0409, all killed: 1 212 mutants, the same ten survivors, the same
score. 2.0.2 holds the sanitizer's server document under a registry name, one
more mutant, killed by a case that pins the name: 1 213 mutants, the same ten
survivors, 99.18 %. Each of the ten is on that file's
`equivalent` list — by file, line, mutator and the text it replaced — with one
sentence saying why the program does the same with and without it: the three
on `detach()`'s paired fields, which are set and cleared together; the two
empty-catch mutants whose `undefined` the callers negate like `false`; the
guard on an undefined handler that the isolating catch would swallow anyway;
the two Trusted Types guards a TypeError inside the same try reaches the same
`null` as; the relative-path pattern's `+`, unanchored at the end; and the
empty-string return `new URL('')` would throw its way to. The policy fails the
run when a survivor is missing from the list or a listed one is killed now,
and the survivors stay visible in the report. The first measurement, on
2026-09-10, was 1 345 mutants and 88.40 %: of its 167 survivors, five were
tests that mattered (the header that turns the merge into a read, a body that
is not a document, `ready` with data, the global `fetch`), 39 lines were
guards no test could reach and are gone, about a hundred were cheap
boundary tests, and the ten above are what is left.

These three rest on two that already existed: the layer rules (no upward
import, no Node builtin in browser code, nothing browser-facing imports the
server side) and the API reports under `etc/api/`, which since this audit mark
every exported name a project is not meant to import as `@internal` —
552 public names and 126 internal, the split measured by `scripts/surface-usage.ts` against what the examples import and the guides name, then closed under what every public signature reaches. The names stay exported, so nothing that compiled stops
compiling; the split is a statement in the report, held byte for byte by
`npm run test:package`.

### What is measured, and what is only argued

The line count, the capability lists, the sink inventory's completeness, the
mutation score and the public/internal split are measured and held by gates.
Two things are not. The **justifications** in the sink inventory are reviews:
the gate forces someone to write one down and checks the evidence it can
(a `<template>` for an inert parse, an `isSafeUrl` call in the module for a
validated URL), but it cannot prove that `outcome.url` at a given site is the
value that passed the check — that is what the reading below is for. And the
scanner reads **names, not data flow**: it sees `fetch` and `innerHTML`, not a
function that is handed `fetch` under another name. The core's own imports are
held exact so that this stays a short list to check by hand.

A thousand lines is about what one reader holds in one sitting, and that was
the size this core set out to be. It is 1 356, and the difference is not a
second responsibility hiding in the list:
133 of the sanitizer's lines are the allow-lists a reader has to read anyway,
and about 130 of the bus's are the queue that commits token verdicts in arrival
order. Moving either into a file of its own would leave the reader the same
lines in two places. The number stands as measured; it was 1 392 when this
page was written, and the core's own mutation run then showed 39 lines no
test could reach — guards a later check repeated, a fallback nothing could
hit, probes the encoding call makes itself — which are gone.

## The core in reading order

Read the modules in this order; each one only depends on the ones before it.
Every invariant has a number so a review can refer to one, and each names the
gate or test that holds it.

### 1. `message-guards.ts` — what counts as a message

- **G1** A message is an object with a string `type`; nothing else is looked
  at until that holds (`isObjectMessage`).
- **G2** A `payload-live-preview` message's `data` is a plain object or absent;
  every optional scalar has its type or is absent; `null` counts as absent,
  because JSON bridges send it (`isLivePreviewMessage`, `normalizeLivePreviewMessage`).
- **G3** `fieldSchemaJSON` is parsed entry by entry and a throw becomes an
  empty schema. A malformed schema can change which renderer a field gets,
  never what is written.
- **G4** Unknown fields are kept, so the protocol can grow without a release.

Held by: the core mutation profile; `tests/unit/core/message-bus-shapes.test.ts`.

### 2. `message-bus.ts` — who may speak, and when a callback may run

- **B1** Origin first, fail closed: only a literal `true` from the origin
  matcher admits a message, a throwing matcher refuses it, and the matcher is
  consulted again at commit time because it may have narrowed since ingress
  (`matchesOrigin`).
- **B2** Under `sourcePolicy: 'parent-or-opener'` the sending window must be the
  attached window's parent or opener; an allowed origin from any other window
  is refused as `source`.
- **B3** Every rejection is dropped or reported through `onInvalid` with one of
  five reasons; the bus never throws into the page's event loop.
- **B4** Each attachment is a generation. A listener from an earlier
  attachment, a validation that resolves after `detach()`, a callback that
  runs after `advanceGeneration()` — none of them reaches a handler
  (`isCurrentGeneration`, checked before every handler and after every await;
  ADR 0004).
- **B5** With `validateToken` set, data-bearing updates commit in arrival
  order even when a later verdict resolves first; only a literal `true`
  approves, an error is a rejection, and the data-less `ready` handshake
  passes without a token so the admin learns the page listens (`drainQueue`).
- **B6** A revision is consumed by every shape-valid update before its token
  is checked, so a rejected token leaves a gap rather than reusing a number.
- **B7** The only thing the bus sends is the `ready` handshake with the
  protocol version, to the targets and origins it was given.

Held by: `message-ingress` is core-only (gate 2); the core mutation profile;
`tests/unit/core/message-bus-*.test.ts` (origin, source, tokens, token
ordering, generations) and the fast-check models in
`tests/unit/property/message-bus*.property.test.ts`.

### 3. `data-merger.ts` — the one request that carries cookies

- **M1** The request goes to `<serverURL><apiRoute>/<collection>/<id>` or
  `/globals/<slug>`, as a POST with `X-Payload-HTTP-Method-Override: GET`, and
  nowhere else; `serverURL` loses its trailing slashes without a regular
  expression that could backtrack.
- **M2** A slug or id with `/`, `\`, a control character, a lone surrogate,
  `.`/`..`, an empty string or over its length limit (128 for a slug, 512 for
  an id) never becomes a URL segment, and a slug with `?` or `#` does not
  either — an id may carry them, encoded; a request that cannot be merged
  returns `unavailable` without a fetch (`endpointOf`, `isPathSegment`).
- **M3** `credentials: 'include'` appears here and in no other browser module
  (gate 2, core-only).
- **M4** The newest merge wins: a newer call aborts the one in flight, and a
  response that arrives after being superseded is dropped even if a fetch shim
  ignored the signal — the attempt counter alone decides, since nothing but
  this class aborts the signal and only after the counter moved (`attempt`).
- **M5** A non-OK response, a non-object body or an exception is
  `unavailable` — the raw values are shown, never a partial document or an
  error body.

Held by: `network` and `credentialed-request` reviewed per module (gate 2);
the core mutation profile; `tests/unit/core/data-merger-*.test.ts`.

### 4. `attribute-binding.ts` — which attribute a remote value may become

- **A1** Event handlers (`on*`), `style`, `srcdoc`, `formaction`, `form`,
  `id`, `name`, `is`, `srcset` and `imagesrcset` are refused by name, before
  any value is looked at (`isWritableAttribute`).
- **A2** `href`, `src`, `poster`, `cite`, `action`, `xlink:href` and `data`
  are written only when the value passes `isSafeUrl`.
- **A3** Only a string, number or boolean is written; `null` and `undefined`
  remove the attribute; anything else is refused.
- **A4** A refused write touches nothing and returns `'blocked'`, which the
  writer reports as LP0401.

Held by: the sink inventory marks this as the one `gated` computed write
(gate 2); the core mutation profile; `tests/unit/core/attribute-binding.test.ts`.

### 5. `url-validator.ts` — which URL is a URL

- **U1** `http:`, `https:`, `mailto:` and `tel:` are the only absolute schemes;
  `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` and `about:` are refused
  by pattern before parsing, with the whitespace a browser would strip.
- **U2** Tab, newline and carriage return are removed before the check, since
  the URL parser drops them anywhere in the input.
- **U3** `#…`, `?…`, `/…`, `//…` and relative paths pass; a backslash pair
  counts as protocol-relative, because the parser treats `\` as `/`.
- **U4** The empty string is never safe: `<a href="">` is never emitted.

Held by: the PR mutation profile (this file is in it) and the core profile;
`tests/unit/security/url-validator.test.ts` and
`tests/unit/property/security.property.test.ts`.

### 6. `escape.ts` — text that stays text

- **E1** `escapeHtml` escapes `& < > " ' / \` =`; the character class and the
  map are one list, so every match has a replacement.
- **E2** `escapeAndLinebreak` escapes first and inserts `<br>` second; the
  order is the invariant.
- **E3** `escapeCssUrl` stops the break-out from a CSS `url()`, not the
  scheme — callers pair it with `isSafeUrl` (the image renderer does, and the
  sink inventory says so).

Held by: the core mutation profile; `tests/unit/security/escape.test.ts`.

### 7. `sanitizer.ts` — which markup CMS content keeps

- **S1** Parsing happens into a `<template>`, whose content is inert: no script
  runs and no resource loads while the fragment is walked (gate 2 checks the
  `createElement('template')` for this site).
- **S2** Tags outside the allow-list are unwrapped, their children kept;
  `script`, `style`, `iframe`, `object`, `embed`, `link`, `meta`, `base`,
  `form`, the form controls, `svg`, `math`, `template` and the frame family are
  removed with their children.
- **S3** `on*` and `style` attributes are removed on every tag, before the
  allow-list is consulted, so no extension can re-admit them.
- **S4** Under `'strict'` — the 2.0 default — `id`, `name` and every
  `data-payload-*` are removed and reported once (LP0409): CMS content can
  neither clobber a global nor add a binding. Other `data-*` pass only when
  listed in `allowedDataAttributes`. `'compat'` keeps them, as 1.x did.
- **S5** `href`, `src`, `cite` and `poster` are removed when `isSafeUrl`
  refuses them; every `srcset` candidate is checked and the attribute goes if
  one fails.
- **S6** An anchor to another HTTP origin gets `rel="noopener noreferrer"` and,
  if it had none, `target="_blank"`.
- **S7** The policy is resolved per call: an explicit option, else the
  instance's, else the process default — so two clients on one page never
  share a policy through this module (ADR 0002).
- **S8** `templateMode` — for an array item template the page author wrote,
  never for CMS content — keeps `id`, `name` and the three reconciliation
  attributes (`data-payload-key`, `data-payload-nested-key`,
  `data-payload-nested-template`); every other `data-payload-*` is still
  removed, so a template cannot add a binding.

Held by: `html-sink` reviewed as `inert-parse` (gate 2); the nightly and core
mutation profiles; `tests/unit/security/sanitizer*.test.ts` (allow-lists,
attributes, policy, environment, the LP0409 report) and the sanitizer
fixed-point properties in `tests/unit/property/security.property.test.ts`.

### 8. `trusted-types.ts` — the one policy

- **T1** One policy, named `payload-live-preview`, whose `createHTML` is the
  identity: what reaches a sink is already sanitised or escaped, and a policy
  cannot re-verify from inside what the call sites guarantee. That is why the
  sink inventory exists.
- **T2** The policy is created on first use and only here (gate 2: the
  capability is core-only). If the site's `trusted-types` directive does not
  list the name, the sink assignment surfaces the enforcement error rather
  than this module swallowing it.
- **T3** Without the Trusted Types API, strings pass through unchanged.

Held by: gate 2; the core mutation profile; `tests/unit/security/trusted-types.test.ts`.

## What sits just outside, and why it can

- **`binding-writer.ts`** is the dispatcher between a scheduled value and its
  element. It holds no capability: its two exits are `applyAttributeBinding`
  (§4) and a renderer, and every renderer's sink is in the inventory. Read it
  next if you want to see that there is no third exit.
- **The renderers** (`src/field-types/`) write text through `textContent`,
  markup only through `trustedHtml(sanitizeHtmlWithPolicy(…))` or
  `trustedHtml(escape…(…))`, and URLs only after `acceptUrl`, which is
  `isSafeUrl` plus one warning. The inventory lists each site.
- **The keyed morph and the structural applier** copy attributes from a node
  this package already checked — a sanitised item or a fragment the page's own
  server rendered — onto the live one (`copied` in the inventory).
- **The fragment and route strategies** fetch the page's own origin with
  `credentials: 'same-origin'`; the route's HTML is parsed by `DOMParser` into
  an inert document before the head merge and morph (ADR 0011).
- **The static bootstrap** creates one `<script>` whose URL and integrity the
  generator baked in.
- **The server-side authorization** (`src/security/preview-*.ts`, `csp.ts`) is
  the other trust question — who may see a draft — answered in
  [authorization.md](authorization.md) and ADR 0006. None of it reaches the
  browser runtime, which is why it is not in this core.

## Running the audit yourself

```sh
npx tsx scripts/check-trusted-core.ts        # lines, imports, the ceiling
npx tsx scripts/architecture-policy.ts       # capabilities and sinks, every module and site
npx tsx scripts/surface-usage.ts             # which exported names the examples and guides use
STRYKER_SCOPE=core npx stryker run stryker.config.js && npm run test:mutation:policy:core
```

All four run from the source; none reads a snapshot. Add a `fetch` to a
renderer, or a line to the sanitizer, and the first two go red before the
change is committed.
