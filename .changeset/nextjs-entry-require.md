---
'payload-live-preview': patch
---

`next.config.ts` can import `withLivePreview` from `payload-live-preview/nextjs` again in a project without `"type": "module"`. Next.js compiles that file to CommonJS and requires it, and the entry was exported for `import` only, so a fresh project failed to build with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The entry now has a `default` condition pointing to the same file, which Node 20.19 and later load through `require`. The Next.js guide's page example also gates its binding attributes on the page's own authorization decision, as the other guides do.
