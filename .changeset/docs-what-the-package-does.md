---
'payload-live-preview': patch
---

The README, the guides and the npm description now say what the package does. Two React or Vue hooks on one page keep their own state, requests and errors, and both follow the document the admin sends; the docs had promised each its own document. The server-side rich-text recipes pass a document for each render with `requireDocument: true`, and the README has a table of who renders each part of the preview and from which data. New sections cover bindings inside fragment components, Payload in the same Next.js app, `trailingSlash: 'always'`, Payload 4's per-locale status, plugin `order`, line breaks in text fields, the merge request's missing deadline, the route render's head sync and the attributes a morph removes. `pll doctor` examples that carry a credential run `node_modules/.bin/pll` with the token in an environment variable, because npm 12's `npx` prints the command line.
