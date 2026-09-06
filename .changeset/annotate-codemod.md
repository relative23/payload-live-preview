---
'payload-live-preview': minor
---

Add `pll-codegen annotate`: put `data-payload-field` where a template already
prints a field, and report every place it will not guess at.

```bash
npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts
npx pll-codegen annotate src/pages --config ../backend/src/payload.config.ts --write
```

Annotating a template by hand is the work this package asks for, and on an
existing site it is the reason to keep using a hook instead. The codemod does the
part that is unambiguous: an element whose entire content is one field access
whose path the schema has — the shape that means the same thing in Astro, JSX and
Svelte.

```astro
<h1>{page.title}</h1>  →  <h1 data-payload-field="title">{page.title}</h1>
```

Everything else is listed with a reason and left untouched: a value printed
beside a label (a binding replaces the whole text), a call or an operator (no
single field to name), a path the schema does not have, an array item inside a
loop (nothing connects the loop variable to the field), a component's props, and
anything already annotated. A missing binding costs an editor one invisible edit;
a wrong one writes a value into the wrong element on every keystroke, and nobody
looks for that in a diff a codemod produced.

Nothing is written without `--write`. A dry run that found work exits 3, so a
pre-commit hook can tell it apart from "nothing to do".
