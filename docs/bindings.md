# Bindings

A binding is an element carrying `data-payload-field`. The runtime finds the
field's value in every update and writes it into that element. Everything
else on this page refines what "writes" means: which renderer, which
attribute, which locale, which document.

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
| `data-payload-owner`           | The document this subtree belongs to (see below)                                                                                                                                                                                                | `data-payload-owner="global:homepage"`             |
| `data-payload-depends`         | Fields whose change re-applies this binding under `skipUnchanged`; separated by commas or whitespace                                                                                                                                            | `data-payload-depends="price currency"`            |
| `data-payload-strategy`        | `patch` (default), `fragment` (server-rendered) or `route` (whole-route refresh); any other value is left alone with `LP0407`. Without it: inside a fragment boundary → fragment, in `<head>` → route, else patch ([docs/hybrid.md](hybrid.md)) | `data-payload-strategy="route"`                    |
| `data-payload-fragment`        | A fragment boundary; the value is a registry id the endpoint renders                                                                                                                                                                            | `data-payload-fragment="hero"`                     |
| `data-payload-fragment-key`    | Distinguishes several boundaries of one id on a page                                                                                                                                                                                            | `data-payload-fragment-key="a"`                    |
| `data-payload-boundary`        | An empty-field anchor: hidden while the field is empty, shown when it is filled                                                                                                                                                                 | `data-payload-boundary hidden`                     |
| `data-payload-island`          | A hydrated framework root: never patched or morphed into; `"patch"` opts back in ([docs/renderers.md](renderers.md))                                                                                                                            | `data-payload-island`                              |
| `data-payload-owned`           | A subtree the site scripts itself: the morph and the head sync leave it alone                                                                                                                                                                   | `data-payload-owned`                               |

Binding metadata is live: changing any of these attributes, or an input's
native `type`, rebuilds the affected bindings after the mutation debounce.

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
