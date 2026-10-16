# ADR 0024 — The one-line setups take the authorization hook by module reference

**Status:** Proposed • **Date:** 2026-09-29

This record adds one option to the two setups that serialize their options:
the Astro integration's `mode: 'middleware'` and the Nuxt module. Nothing
about the strict default, the hook's contract or the hand-written setups
changes.

## Context

The strict 2.0 default refuses to deliver the runtime without
`authorizePreview`: a response changes only for a request the server has
verified (ADR 0006). Two setups cannot carry that function. The Astro
integration writes its options into a virtual module for the middleware it
registers, and the Nuxt module writes them into a Nitro plugin in `.nuxt/`;
both go through `JSON.stringify`, which drops a function. Their guides
therefore showed `strict: false` or `defaults: 'v1'`, which delivers on
client-controlled intent alone, as the short path, and the secure setup as
the longer alternative (H12). The shortest working path was the one that is
not authorization.

## Decision

### 1. `authorizePreviewModule` names a server module whose default export is the hook

```ts
livePreview({
  mode: 'middleware',
  authorizePreviewModule: './src/live-preview/authorize.ts',
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
});
```

The setup writes an import of that module into the source it already
generates and passes its default export as `authorizePreview`. The function
never crosses the serialization; the bundler resolves the module at build
time, as it resolves any server import. The strict default is then met, and
the refusal to build under strict without a hook stays for a setup that
names neither.

The Nuxt module also registers the server handler with the same options and
the same import. Its plugin runs in `render:html`, after the app rendered, so
a page reading the decision on `event.context` for its bindings or its draft
read found none; the handler decides before the app renders, and the plugin
reuses its decision. Found by probing a clean project built from the guide:
the editor's request received the runtime and a page without bindings. The
intent-only setup, which has no decision to publish, keeps the plugin
alone.

### 2. How the reference is resolved

A path beginning with `./` is relative to the project root: Astro's
`root`, Nuxt's `rootDir`. The Astro integration hands Vite a root-relative
path; the Nuxt module an absolute one, because its plugin is written into
`.nuxt/`. Any other specifier (a package, or an alias such as Nuxt's `~/`)
is passed to the bundler unchanged. A path beginning with `../` is refused:
the module is server code of this project, and a reference outside it is
more likely a mistake than a layout.

### 3. The generated code checks what it imports

If the default export is not a function, the generated module throws when
the server loads it, naming the reference, rather than refusing every
preview request later with an authorization error that points elsewhere.
The option is refused in the Astro integration's other modes, where no
request reaches a server hook.

### 4. The guides lead with the secure setup

Each framework guide shows the setup that authorizes first: the reference
for Astro's integration and Nuxt's module, the hook in the adapter call for
SvelteKit and Next.js. Intent-only delivery stays documented, under a
heading that says it is not authorization.

## Alternatives

- **Serialize the function's source.** A closure's variables, imports and
  secrets do not travel with its text; what runs would not be what was
  written.
- **Only document the hand-written setup.** That is what the guides did; the
  one-line setup stayed the intent-only one, and it is the one people copy.
- **A generic `serverModule` with several exports.** One option per hook keeps
  the contract checkable; `shouldInject` can follow the same pattern if a
  second caller appears.

## Consequences

- Additive minor option on the Astro integration and the Nuxt module.
- The strict default works with the one-line setups. The Astro middleware
  fixture moves to it; the Nuxt fixture keeps the 1.x profile its runtime
  suites are written for (H18), and the Nuxt setup is proven in a clean
  project.
- Acceptance: unit tests of the generated sources and the refusals; native
  proof that an authorized request receives the runtime and an intent-only
  request does not, for Astro's integration and Nuxt's module; clean projects
  built from the guides with an authenticated `pll doctor` probe; the full
  chain.

## Addendum (2026-10-02): the reference names the file

The first real-admin run of the Nuxt example found the documented reference
failing in `nuxt dev`: the generated plugin imported
`<project>/server/utils/live-preview-auth` without an extension, `nuxt dev`
loads that file as it stands, and nothing there looks for a TypeScript file by
its bare path. It answered 500 ("Cannot find module"). The production build
bundled the same reference, with `./`, `~/` and `~~/` forms alike, and the unit
tests only read the source the module generates, so none of them loaded it in
development. An explicit `.ts`
worked in development.

The module now writes the file a `./` reference or one of Nuxt's aliases points
at, with the extension it has (`.ts`, `.mts`, `.js`, `.mjs`, `.cts`, `.cjs`, in
that order, then a directory's `index`), and leaves the reference as written
when it reads no such file, for the bundler to report. An alias is read from
`nuxt.options.alias`; a package specifier is untouched. `adapters/nuxt/module.js`
grows by +570 B raw, +235 B gzip and +223 B brotli. The Nuxt example runs this
setup when `PLP_PAYLOAD_SERVER_URL` names the admin, and the real-admin suite
exercises it in `nuxt dev` with the editor's real session.
