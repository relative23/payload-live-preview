---
'payload-live-preview': minor
---

`livePreviewAnnotate()`: bindings written at build time, bound to the request's authorization.

```js
// astro.config.mjs
import { livePreviewAnnotate } from 'payload-live-preview/annotate';

export default defineConfig({
  vite: { plugins: [livePreviewAnnotate({ inventory })] },
});
```

A template keeps the markup its author wrote — `<h1>{page.title}</h1>` — and the build rewrites it to `<h1 {...__lpPreview.bind('title')}>`, one helper per file, built from `Astro.locals`. The binding therefore exists for a preview the adapter authorized and does not exist for anyone else: the fixture's public response carries no `data-payload-*` at all, while the tokened one carries exactly the fields the template prints.

What may be annotated is decided by the same scanner as `pll-codegen annotate` and nowhere else, so the two annotate the same places and refuse the same ones. A statically built page has no request to authorize and emits nothing; `allowPublicBindings: true` writes the plain attribute there instead, which is the same disclosure the codemod makes, said out loud.

Astro only, and for a reason rather than a lack of time: the rewrite needs a template whose own scope can reach the request context. Frontmatter and `Astro.locals` give that; a Svelte or Vue component does not, since the verdict would have to travel through `load` or a serialized payload, where a function cannot go.

It hooks `load`, not `transform`. Astro compiles `.astro` in a `transform` of its own registered ahead of anything a config contributes, so by the time a user transform runs the markup is already compiled away — measured with a probe plugin, not assumed. `name`, `enforce` and `load` are the whole surface used, all stable since Vite 5, and the majors it is exercised against are read from `quality/compat-matrix.json` rather than typed here.

New: `payload-live-preview/annotate`, separate from `./codegen` so a build plugin never drags `ts-morph` into a project, and `previewBindingsFromLocals()` on `payload-live-preview/server` — the one-line helper the generated call uses, and useful by hand. `vite` is now an optional peer (`>=5.4.0 <9.0.0`), never a dependency.
