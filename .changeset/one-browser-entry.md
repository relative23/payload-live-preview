---
'payload-live-preview': major
---

`payload-live-preview/client` is the one browser entry (ADR 0007, row 46). `payload-live-preview/core`, `payload-live-preview/plugins` and `payload-live-preview/structural` are gone, and `/client` exports what they exported for a browser: the client, `createDocumentSession()`, `PluginManager` and the built-in plugins, the protocol and origin helpers, the sanitizer, and the keyed morph (`morphElement()`, `isMorphBoundary()`, `retainIslandBoundary()`).

- The root exports every name of `/client` and, beside it, the script generator and the server helpers. It gains the six names only the focused entries had: `createDocumentSession`, `PluginManager`, `createUnboundFieldsOverlayPlugin`, `morphElement`, `isMorphBoundary` and `retainIslandBoundary`.
- `npx pll migrate ./src --write` rewrites the imports (`move-core-entry`, `move-plugins-entry`, `move-structural-entry`). `/core` also exported `bind()`, `bindByPath()`, `createPreviewBindings()`, `buildFrameAncestors()`, `generateCspNonce()` and `isAuthorizedPreviewContext()`; an import of only those goes to the root, and one that mixes them with browser names is reported for you to split.
- Four types of `/structural` described functions that 3.0 no longer exports and are gone: `ArrayPatch`, `DependencyMap`, `StructuralApplyOptions` and `StructuralStore`.
- A bundler gives the same bytes for a name from the root or from `/client`. A page that loads an entry without a bundler loads it whole: `/client` is 187 kB in 38 files and the root 376 kB in 49, since the root holds the script generator with the runtime as text.
- Every module that defines a public name is a file of its own in the build. A bundler that takes a file whole, as webpack and Turbopack do, ships the feature a project imports and not its neighbours: a Next.js 16 app pays 2.8 kB gzip for `PluginManager` and 0.9 kB for one built-in plugin.
