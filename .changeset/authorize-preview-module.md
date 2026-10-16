---
'payload-live-preview': minor
---

Astro's `mode: 'middleware'` and the Nuxt module can now run under the strict default. Both serialize their options into the build, so they could not carry the `authorizePreview` function and needed `defaults: 'v1'` or `strict: false`, which delivers the runtime on client-controlled intent alone. The new `authorizePreviewModule` option names a server module whose default export is the hook; the generated middleware or Nitro plugin imports it. A path beginning with `./` is relative to the project root, a package or alias specifier is passed to the bundler unchanged, and a path outside the project is refused. If the module's default export is not a function, the server says so when it loads. With a reference the Nuxt module also registers the server handler, so a page reads the decision on `event.context` while it renders. The guides now lead with this setup.
