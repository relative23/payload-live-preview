---
'payload-live-preview': major
---

The package is one module graph, ESM alone (ADR 0007, row 43). Until 3.0 every entry was a bundle of its own, ten of them built as ESM and as CommonJS, so each class and each registry existed once per entry. A module two entries share is built once now, as a chunk both import.

- A Lexical node or block renderer registered through one entry is the one every other entry renders with.
- There is no CommonJS build and no `.cjs` file. The entries that had a CommonJS build, and `/nextjs`, answer `require()` with the same ES module `import` gets, which Node 24 loads through `require` too, so a CommonJS `next.config.js` keeps working.
- The JavaScript in the archive goes from 2 751 547 bytes to 541 124. What a bundler keeps for one imported name is level with 2.x. An entry loaded unbundled reads more than its single file was: 3 to 5 % for the adapters, 6 % for the root, about 22 % for the hooks.
- Import an entry by its name. The files under `dist/` that the entries share change their names with every release.
- A page that loads an entry in the browser without a bundler serves the package's `dist/` folder, not one copied file: an entry imports the chunks beside it. `/client` is 19 files with 168 kB together.
