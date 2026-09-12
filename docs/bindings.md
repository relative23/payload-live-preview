# Bindings

A binding is an element carrying `data-payload-field`. The runtime finds the
field's value in every update and writes it into that element. Everything
else on this page refines what "writes" means: which renderer, which
attribute, which locale, which document.

## How much markup this actually needs

Start here, because the honest answer is "less than the rest of this page
suggests". Three routes, and the first one is usually the right one:

| Your page is                                       | Start with                 | Markup for a component |
| -------------------------------------------------- | -------------------------- | ---------------------- |
| server-rendered (Astro SSR, Next, SvelteKit, Nuxt) | one boundary per component | **one attribute**      |
| static, no server at request time                  | field bindings             | one per field          |
| client-rendered React or Vue                       | the hook or composable     | none                   |

A **boundary** marks a region your server can render again from the unsaved
form state. One attribute, and everything inside it is as correct as a full
page render — conditional sections, derived values, custom blocks, a
component's own logic:

```astro
<section data-payload-fragment="hero" data-payload-depends="title,subtitle,body">
  <Hero {...page} />
</section>
```

The same component with field bindings instead, which is what the rest of this
page is about:

```astro
<h1 data-payload-field="title">{page.title}</h1>
{page.subtitle && <p class="lede" data-payload-field="subtitle">{page.subtitle}</p>}
<div data-payload-field="body" data-payload-richtext>{body}</div>
<p>{wordCount(page.body)} words</p>
```

Three lines against twelve, and the boundary version also fixes what the
bindings cannot: the `subtitle` paragraph does not exist while the field is
empty, so an editor filling it sees nothing, and the word count is derived, so
no field names it.

**What the boundary costs.** A route that renders it — `createFragmentEndpoint()`
in your framework, authorized like the page — and therefore a server at request
time ([hybrid.md](hybrid.md)). A static build has none, which is why field
bindings exist and why they are not going anywhere.

**Why you will still want field bindings inside a boundary.** A server render
replaces the region; a patch writes into the element that is already there. For
a field an editor types into while looking at it, the patch keeps focus, the
caret and scroll position. So: boundary for the component, bindings for the two
or three fields being edited. Both at once is the normal case — the bindings
inside a boundary are also its fallback when the server cannot render.

## Attribute reference

| Attribute                      | Purpose                                                                                                                                                                                                                                         | Example                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `data-payload-field`           | Bind the element to a field path                                                                                                                                                                                                                | `data-payload-field="hero.title"`                  |
| `data-payload-type`            | Force a renderer (a built-in type or a namespaced custom key)                                                                                                                                                                                   | `data-payload-type="image"`                        |
| `data-payload-attribute`       | Write the value into an attribute instead of the content. Event handlers, `style`, `srcdoc`, `formaction`, `form`, `id`, `name`, `is`, `srcset` and `imagesrcset` are refused; URL attributes take safe URLs only                               | `data-payload-attribute="datetime"`                |
| `data-payload-href`            | Read `href` from another field                                                                                                                                                                                                                  | `data-payload-href="ctaUrl"`                       |
| `data-payload-src`             | Read `src` from another field                                                                                                                                                                                                                   | `data-payload-src="hero.url"`                      |
| `data-payload-alt`             | Read `alt` from another field                                                                                                                                                                                                                   | `data-payload-alt="hero.alt"`                      |
| `data-payload-richtext`        | Force Lexical rendering (usually detected from the value)                                                                                                                                                                                       | `data-payload-richtext`                            |
| `data-payload-html`            | Render the value as sanitized HTML                                                                                                                                                                                                              | `data-payload-html`                                |
| `data-payload-text`            | Let a text write replace element children. Without it a text binding whose element has element children is skipped with `LP0402`, so a styled wrapper is not destroyed                                                                          | `data-payload-text`                                |
| `data-payload-array`           | Treat the value as an array                                                                                                                                                                                                                     | `data-payload-array`                               |
| `data-payload-array-template`  | Markup per array item; `{{field}}` reads the item                                                                                                                                                                                               | `data-payload-array-template="<li>{{title}}</li>"` |
| `data-payload-array-separator` | Separator for arrays of primitives                                                                                                                                                                                                              | `data-payload-array-separator=" · "`               |
| `data-payload-structural`      | Diff-based keyed updates for arrays: unaffected items keep their DOM state ([docs/renderers.md](renderers.md))                                                                                                                                  | `data-payload-structural`                          |
| `data-payload-nested-key`      | Inside an array template: the item field holding a nested array                                                                                                                                                                                 | `data-payload-nested-key="slides"`                 |
| `data-payload-nested-template` | The template for that nested array's items                                                                                                                                                                                                      | `data-payload-nested-template="<li>{{t}}</li>"`    |
| `data-payload-key`             | Written by the runtime from each item's `id`; never write it yourself                                                                                                                                                                           | —                                                  |
| `data-payload-locale`          | Read this locale's value (`field_<locale>`) regardless of the message locale                                                                                                                                                                    | `data-payload-locale="de-AT"`                      |
| `data-payload-format`          | How a date or number is written; a closed vocabulary, see below                                                                                                                                                                                 | `data-payload-format="currency:EUR"`               |
| `data-payload-owner`           | The document this subtree belongs to (see below)                                                                                                                                                                                                | `data-payload-owner="global:homepage"`             |
| `data-payload-depends`         | Fields whose change re-applies this binding under `skipUnchanged`; separated by commas or whitespace                                                                                                                                            | `data-payload-depends="price currency"`            |
| `data-payload-strategy`        | `patch` (default), `fragment` (server-rendered) or `route` (whole-route refresh); any other value is left alone with `LP0407`. Without it: inside a fragment boundary → fragment, in `<head>` → route, else patch ([docs/hybrid.md](hybrid.md)) | `data-payload-strategy="route"`                    |
| `data-payload-fragment`        | A fragment boundary; the value is a registry id the endpoint renders                                                                                                                                                                            | `data-payload-fragment="hero"`                     |
| `data-payload-fragment-key`    | Distinguishes several boundaries of one id on a page                                                                                                                                                                                            | `data-payload-fragment-key="a"`                    |
| `data-payload-boundary`        | An empty-field anchor: hidden while the field is empty, shown when it is filled                                                                                                                                                                 | `data-payload-boundary hidden`                     |
| `data-payload-island`          | A hydrated framework root: never patched or morphed into; `"patch"` opts back in ([docs/renderers.md](renderers.md))                                                                                                                            | `data-payload-island`                              |
| `data-payload-owned`           | A subtree the site scripts itself: the morph and the head sync leave it alone, and so does `autoBind`                                                                                                                                           | `data-payload-owned`                               |
| `data-payload-no-bind`         | A subtree `autoBind` never guesses into; a declared binding inside it still works (see below)                                                                                                                                                   | `data-payload-no-bind`                             |
| `data-payload-guessed`         | Written by the runtime on every binding `autoBind` made, holding the value it matched; never write it yourself                                                                                                                                  | —                                                  |

Binding metadata is live: changing any of these attributes, or an input's
native `type`, rebuilds the affected bindings after the mutation debounce.

### Formatting a date or a number

A bound date is written as a localised date and time, a bound number with the
locale's grouping. `data-payload-format` picks something else, from a closed
vocabulary:

| Value                                  | Writes                                     |
| -------------------------------------- | ------------------------------------------ |
| `date`                                 | `17 Oct 2026`                              |
| `date:short` `:medium` `:long` `:full` | `17/10/2026` … `Saturday, 17 October 2026` |
| `time`                                 | `15:05`                                    |
| `datetime`                             | `17 Oct 2026, 15:05` (the default)         |
| `number`                               | `1,234.5`                                  |
| `number:0` … `number:4`                | fixed fraction digits                      |
| `currency:EUR` (any ISO 4217)          | `€12.00`                                   |
| `percent`                              | `25%` for `0.25`                           |

```astro
<time data-payload-field="startsAt" data-payload-format="date:long">17 October 2026</time>
<span data-payload-field="price" data-payload-format="currency:EUR">€12.00</span>
```

The locale is the element's `data-payload-locale`, else the message's, else the
document's `lang`. A `<time>` keeps the ISO instant in its `datetime` attribute
whatever the label says.

Leaving the attribute off is not neutral: the renderer still has to pick a
format, and if the template picked a different one the preview stops matching
the page the server would send. The runtime cannot tell which of the two is
right — the element's text is the only evidence it has, and the first message of
a connection may already carry unsaved edits — so it says what it saw instead of
guessing. The first write to a date, number or checkbox binding without this
attribute is held against what the element showed, and a difference is reported
once as [`LP0412`](troubleshooting.md#diagnostic-codes) with both readings in
it. Setting `data-payload-format` to the format the template uses ends it.

Three things it does not do. It formats the amount it is given, so a field
holding minor units renders as minor units — dividing would be data shaping, and
the runtime cannot know which fields are cents. It formats in the visitor's time
zone, which may not be the server's. And there is no relative form ("in 3
days"): choosing the unit and its rounding is policy rather than formatting, and
belongs on the server behind a fragment. An unknown value is reported as
`LP0408` and the default formatting is used instead.

**Svelte and Vue templates.** The `{{field}}` in `data-payload-array-template`
is read by this package, but Svelte reads `{...}` and Vue reads `{{ ... }}` as
their own interpolation, so the template written inline is a compile error or
an empty string. Bind it as a string:

```svelte
<script lang="ts">
  const template = '<li><a data-payload-href="url">{{title}}</a></li>';
</script>
<ul data-payload-field="posts" data-payload-array-template={template}></ul>
```

```vue
<script setup lang="ts">
const template = '<li><a data-payload-href="url">{{title}}</a></li>';
</script>
<template>
  <ul data-payload-field="posts" :data-payload-array-template="template"></ul>
</template>
```

## Field types

`text` · `textarea` · `richText` · `html` · `email` · `number` · `checkbox` ·
`date` · `select` · `radio` · `relationship` · `upload` · `image` · `url` ·
`array` · `blocks` · `structural-array`

The type comes from `data-payload-type` when set, else from the field schema
when the admin sends one (Payload 2.x), else from the element: the marker
attributes (`data-payload-richtext`, `data-payload-html`,
`data-payload-structural`, `data-payload-array`), then `<img>` → `image`,
`<a>` → `url`, `<time>` → `date`, `<input type="checkbox|number|date">` →
`checkbox`, `number`, `date`. Everything else is `text`. Lexical values are
recognized by shape, so `data-payload-field` alone is enough for rich text.

Custom renderers register through the plugin system under a namespaced key
such as `acme:money`. What a renderer receives, how it is chosen and what a
plugin owns is in [docs/renderers.md](renderers.md).

## Empty-field anchor

The runtime can only patch elements that exist. A template that renders a
binding only when the field is non-empty gives an edit to a previously empty
field nowhere to land (`LP0201`). Render the anchor unconditionally:

```astro
<div data-payload-field="subtitle">{subtitle ?? ''}</div>
```

The warning reaches one level into a group: a document with an unbound
`admission` group names `admission.priceFrom`, the path a binding would carry,
rather than the object around it. A group with a binding on any path inside it
counts as addressed and is not reported, and arrays are left alone — an array
item without an anchor is a template decision.

`PreviewBoundary` renders that anchor with `data-payload-boundary`: as an
empty `hidden` element while the value is empty, so a visitor and a screen
reader see nothing, and the runtime removes `hidden` when an update fills the
field and restores it when the field is emptied again:

```astro
---
import PreviewBoundary from 'payload-live-preview/astro/PreviewBoundary.astro';
---
<PreviewBoundary field="subtitle" value={page.subtitle} as="p" class="lede">
  {page.subtitle}
</PreviewBoundary>
```

Props: `field`, `value` (decides only whether the anchor starts hidden), `as`
(default `div`), `type` (forwarded as `data-payload-type`); other attributes
are forwarded to the wrapper. The anchor is a patch target; markup a server
renders lives in a `data-payload-fragment` boundary instead.

For rich text, `RichText` renders the Lexical value through the same
serializer the runtime uses for live updates and emits the binding with
`data-payload-richtext`, empty anchor included:

```astro
---
import RichText from 'payload-live-preview/astro/RichText.astro';
---
<RichText value={page.body} field="body" class="prose" />
```

## Letting the runtime find bindings by value

`autoBind: 'unique'` (off by default, on the client, the inline script and
every adapter) is for a page that carries no `data-payload-field` at all. The
connection's first message describes the document the server has just
rendered, so in that one moment the runtime looks each scalar field's value up
in the page. Where the value is the whole content of **exactly one** element —
its only text node, or one attribute the writer may set, an `<img src>` for an
upload — that element is bound to the field as if the attribute stood there.
Where it is found nowhere, more than once, as part of a longer text, or split
across nodes, nothing is bound, and the field is as unbound as it was: LP0201
names it, and `onUnfaithfulPatch` escalates an edit to it.

A guess is a binding like any other afterwards, with one difference you can
see: the element carries `data-payload-guessed` with the value it was found by,
`inspect().bindings.guessed` lists it apart from the declared ones, and the
[unbound-fields overlay](../README.md) shows it under its own heading with the
attribute to paste. Copy that attribute into the template and the guess
becomes a declaration.

What it never does, so a wrong element is not rewritten on every keystroke:

- It never enters `<script>`, `<style>`, `<template>`, `<title>`, a form
  control, a `contenteditable` region, a shadow tree, an island, a
  `data-payload-owned` subtree, the `<head>`, or anything under
  `data-payload-no-bind` — the attribute to put on a footer, a navigation or
  a sidebar whose text happens to repeat a field.
- A declared `data-payload-field` wins, as an anchor and as a veto: the element
  and its subtree are spoken for. A page that carries one attribute is not
  thereby opted into guessing for the rest; `autoBind` is what opts in.
- It never looks for a value shorter than thirteen characters, one that is
  only digits, a boolean, a single lower-case token (an enum value, a slug) or
  a locale code — those match by accident. So a `count` of `12` is never
  guessed; neither is a `status` of `published`.
- It searches once. A value that first appears in a later message is never
  bound, because by then the page is what the runtime made it. The one page
  it searches again is one the server rendered again: a route refresh morphs
  the page toward markup that carries no stamp, so the runtime then looks for
  the guesses it already made — by the value each was found by and by the
  field's current value, since the server may have rendered either — and for
  nothing else. A refresh once took every guess with it, and each edit to a
  guessed field after that fetched the route again; that is what closed it.
  A fragment render inside a boundary still strips a guess in that boundary,
  and only the next route refresh brings it back.

Two things to know before turning it on. A date or a number it binds inherits
no `data-payload-format`, so the first write reports
[`LP0412`](troubleshooting.md#diagnostic-codes) where the template formatted
the value differently — the diagnostic is the measure of what the guess could
not know. And a guess rests on the value being unique on the page: a title
that is also the link text in the navigation is not bound, and a city name
that only the footer prints would be, were it not for the length floor. The
trap corpus in `tests/fixtures/auto-bind-traps` is where those cases are
written down and held; [ADR 0014](architecture/0014-auto-binding.md) is where
the rule and the four ways it can fail are decided.

## Pages that preview more than one document

A binding's identity is its field path alone. On a page that renders several
documents — a page global, shared SEO metadata, a list of collection rows — a
field called `title` in any of them matches every `title` on the page.

`data-payload-owner` names the document a subtree belongs to. It is resolved
from the nearest marked ancestor, the element itself included, so a shell
component owns a whole region and a nested document overrides the owner it
would inherit:

```astro
<section data-payload-owner="global:homepage">
  <h1 data-payload-field="title">{page.title}</h1>
  <article data-payload-owner={`collection:services:${service.id}`}>
    <h2 data-payload-field="title">{service.title}</h2>
  </article>
</section>
```

The grammar is `global:<slug>`, `collection:<slug>` or
`collection:<slug>:<id>`. A marker without an id claims every document of that
collection. Enforcement is the `scopeBindingsByOwner` option
([docs/options.md](options.md)), off by default. While it is on:

- an update reaches only bindings owned by the document it names;
- a binding without an owner is never updated;
- an exact `collection:<slug>:<id>` marker stays unreachable while the message
  carries no document id;
- a message naming neither a global nor a collection changes nothing and
  warns once (`LP0202`).

## Keeping binding attributes off public responses

`data-payload-field` names a CMS field and `data-payload-owner` names a
document. Emitted unconditionally they publish the shape of the content model
to every visitor and crawler. `createPreviewBindings()` applies the request's
authorization once, so no call site can forget it:

```astro
---
import { createPreviewBindings } from 'payload-live-preview/server';

const preview = createPreviewBindings({
  authorization: Astro.locals.livePreviewAuthorization ?? null,
  owner: `global:${slug}`,
});
---
<section {...preview.owner()}>
  <h1 {...preview.bind<Homepage>('heroTitle')}>{data.heroTitle}</h1>
  <div {...preview.bind<Homepage>('intro', { richtext: true })} />
</section>
```

While unauthorized every helper returns an empty attribute set, so the
response carries no `data-payload-*` at all. A field travels with its type,
locale, rich-text marker and owner: pass companions through `BindOptions`
(`attribute`, `type`, `richtext`, `html`, `locale`, `alt`, `href`,
`arrayTemplate`) rather than writing the attributes next to a gated field,
where they would stay behind when the gate closes. Where the authorization
comes from is in [docs/authorization.md](authorization.md).

`preview.boundary()` gates a server-rendered boundary the same way, because a
registry id and the fields it depends on describe the content model as much as a
binding does:

```svelte
<section {...preview.boundary('hero', { dependsOn: ['title', 'subtitle'] })}>
```

It writes `data-payload-fragment`, `data-payload-depends` and — with `key` —
`data-payload-fragment-key`, and nothing at all while unauthorized. An id the
endpoint would refuse (anything but lowercase `[a-z][a-z0-9-]*`) throws here
rather than becoming a boundary that silently never renders. What the endpoint
does with the id: [hybrid.md](hybrid.md).

Do not key CSS off `data-payload-*`: a selector that reads "no filled
binding" as "empty section" changes the public layout the moment the
attributes are gated. Style on a marker of your own.

## Typed bindings and codegen

Generate interfaces from the Payload config (`ts-morph` must be installed; it
is an optional peer dependency):

```bash
npx pll-codegen --config ../backend/src/payload.config.ts --out src/lib/bind-types.ts
```

Flags: `-c/--config`, `-o/--out` (both required), `--inventory <path>`,
`--tsconfig <path>`, `-q/--quiet`. `livePreviewCodegen({ configPath, outPath })`
from `payload-live-preview/codegen/astro` runs the same generation on start
and, during `astro dev`, whenever the config or a file beside it changes.

```astro
---
import { bind } from 'payload-live-preview/server';
import type { Homepage } from '../lib/bind-types';
---
<h1 {...bind<Homepage>('heroTitle')}>{data.heroTitle}</h1>
<img {...bind<Homepage>('heroImage', { attribute: 'src' })} />
```

`bind('title')` emits `data-payload-field="title"`; a misspelled field name
fails the build. `bindByPath<T>((d) => d.hero.title)` records the path
through a proxy, so a rename follows; array indices are dropped
(`d.slides[0].title` → `slides.title`). Both take the same `BindOptions` as
`createPreviewBindings().bind`, which is the gated form of the same call.

With `revealEditedField` the preview scrolls to the binding of the field
being edited: [docs/reveal.md](reveal.md).

### Annotating an existing template

`pll-codegen annotate` puts `data-payload-field` where a template already prints
a field, and reports every place it will not guess at:

```bash
npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts
npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts --write
```

Without `--write` nothing is touched; the report is the whole output, and the
exit code is 3 when a dry run found work — a pre-commit hook can tell that apart
from "nothing to do".

It annotates one shape, the one that means the same thing in Astro, JSX and
Svelte: an element whose entire content is a single field access whose path the
schema has.

```astro
<h1>{page.title}</h1>          →  <h1 data-payload-field="title">{page.title}</h1>
<p>{page.hero.eyebrow}</p>     →  <p data-payload-field="hero.eyebrow">…</p>
```

Everything else is listed with a reason and left alone:

| Left alone                                               | Why                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `<p>Published {page.date}</p>`                           | A binding replaces the element's whole text, label included. Split the markup first.                                        |
| `<p>{formatDate(page.date)}</p>`                         | Derived: no single field to name. `data-payload-format` covers dates and numbers ([above](#formatting-a-date-or-a-number)). |
| `<p>{page.internalNote}</p>`                             | The schema has no such field, so the binding would name something that never arrives.                                       |
| `{page.slides.map((slide) => <li>{slide.caption}</li>)}` | Nothing connects `slide` to the `slides` field; array items are annotated by hand ([structural arrays](#field-types)).      |
| `<Hero title={page.title} />`                            | A component's props are its own business.                                                                                   |
| Anything already annotated                               | Yours wins, always.                                                                                                         |

A missing binding costs an editor one invisible edit; a wrong one writes a value
into the wrong element on every keystroke. That asymmetry is why the tool reports
rather than guesses.

### Annotating at build time instead

The codemod writes the attribute into the file, where it is part of every
response. `livePreviewAnnotate()` writes the same decision as a call instead,
resolved per request against the authorization the adapter published — so the
template stays as its author wrote it and a public response carries no
`data-payload-*` at all.

```js
// astro.config.mjs
import { livePreviewAnnotate } from 'payload-live-preview/annotate';

export default defineConfig({
  vite: { plugins: [livePreviewAnnotate({ inventory })] },
});
```

```astro
<h1>{page.title}</h1>   →   <h1 {...__lpPreview.bind('title')}>{page.title}</h1>
```

`inventory` is what `generateTypes()` returns, or the file `pll-codegen
--inventory` writes; only the field paths are read. The helper is built once per
file from `Astro.locals`, which is why this is Astro-only: the rewrite needs a
template whose own scope reaches the request context, and a Svelte or Vue
component's does not — there the verdict would have to travel through `load` or
a serialized payload, where a function cannot go. Both routes decide what is
safe in the same scanner, so they annotate the same places and refuse the same
ones; the table above applies unchanged.

A statically built page has no request to authorize, so it emits nothing.
`allowPublicBindings: true` writes the plain attribute there instead — the same
output as the codemod, and the same disclosure, said out loud rather than
arrived at.
