# ADR 0025 — A server render can require a sanitizer document

**Status:** Proposed • **Date:** 2026-09-29

This record adds an opt-in to `lexicalToHtml()` and the `RichText` Astro
component and records the 3.0 default it becomes. The 2.x default does not
change.

## Context

`sanitizeHtml()` needs a DOM and throws `SanitizerEnvironmentError` without
one. `lexicalToHtml()` does not: during server rendering without a document
(the per-call `document`, the deprecated process-wide slot, or a global DOM)
it warns once and returns its markup unsanitised (H10). Built-in node
renderers escape every value they interpolate, so their output is safe
either way; a custom node or block renderer's markup is then trusted as
written. The browser runtime and a server render with a document pass both
through the same sanitizer and policy, so the gap is the DOM-less server
render and nothing else.

A project cannot see the gap from its output: the page looks the same, and
the one warning scrolls away with the build log. Removing the lenient path
is a behaviour change that breaks every server render without a document,
which AGENTS' compatibility rule defers to 3.0.

## Decision

### 1. `requireDocument` makes the render fail closed

`lexicalToHtml(content, { requireDocument: true })` sanitises with the
document it has and throws the sanitizer's own `SanitizerEnvironmentError`
when it has none, exactly as `sanitizeHtml()` does. It never returns
unsanitised markup and never warns. `sanitize: false` still wins: a caller
that opts out of sanitising has said so. The `RichText` Astro component
passes a `requireDocument` prop through.

### 2. The default flips in 3.0

In 3.0 `requireDocument` defaults to `true` (ADR 0007 ledger). Until then
the warning says so and names the opt-in, so a project finds the change in
its own log, not in the release notes.

### 3. One rule for both functions and for every renderer

Under the option `lexicalToHtml()` and `sanitizeHtml()` answer a missing DOM
the same way, and built-in and custom renderer output reach the page only
through the sanitizer, on the server as in the browser. The per-call
`document` is the recommended way to supply the DOM; the warning and the
error name it rather than the deprecated `setSanitizerDocument()`.

### 4. No codemod

Whether a call site has a DOM to pass is a fact of the project, not of its
source text; `pll migrate` cannot know it, and a rewrite that added
`requireDocument: true` would turn working builds into failing ones. The
migration guide lists the change with the two ways through it: pass a
document, or opt in now and let the build say where one is missing.

## Alternatives

- **Fail closed by default in 2.1.** Correct, but a breaking change on a
  minor release.
- **Escape custom renderer output without a DOM.** It changes the markup of
  every custom renderer silently and still trusts nothing more than before.
- **Drop custom renderer output without a DOM.** Content disappears with no
  error to say why.

## Consequences

- Additive minor option; the default behaviour and its warning stay, with a
  clearer warning.
- The Astro fixture renders `RichText` with a per-call document and
  `requireDocument`; the packed consumer proves the refusal without a global
  DOM.
- Acceptance: unit tests for the refusal, the opt-out, the per-call document
  and the warning; the packed ESM and CommonJS DOM-less probes; the native
  Astro render; the full chain, nightly and the core mutation scope, since
  the sanitizer's message changed.
