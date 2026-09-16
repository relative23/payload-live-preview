---
'payload-live-preview': patch
---

`pll-codegen annotate` no longer binds a field printed from a loop item to the document field of the same name.

`{slide.title}` inside `page.slides.map(...)` became `data-payload-field="title"` whenever the document had a top-level `title`, without a line in the report, so typing into the page title overwrote every slide heading in the preview. A name bound as an array item (a `map`, `flatMap` or `forEach` callback parameter, a `for … of` variable, a Svelte `{#each … as item}`) now refuses the field with a reason. The help no longer promises a report line for elements that already carry `data-payload-field`; they are left as they are, as before.
