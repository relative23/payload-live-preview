---
'payload-live-preview': patch
---

`pll-codegen annotate` and `livePreviewAnnotate()` report an `<a>` and a `<title>` instead of binding them. An `<a>` binding writes the value into `href` as well as the text, so the first message would have pointed a labelled link at its label and dropped the `mailto:` of an address; the head belongs to the route strategy, and a title there usually carries more than the field. `<script>`, `<style>` and HTML comments are no longer read as template, and neither is Astro frontmatter in `pll-codegen annotate`, which the plugin already skipped: their content gave report lines and could be annotated, a string of markup in a script included. The plugin's refusals now carry the line in the file rather than in the template after the frontmatter.
