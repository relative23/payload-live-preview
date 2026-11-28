/**
 * The package's build entries, kept apart from `tsup.config.ts` so tests and
 * gates can read them without loading tsup. Since 3.0 they are one module
 * graph: every entry is built in one ESM profile with shared chunks, so a class
 * or a registry exists once whichever entries a project imports (ADR 0012).
 * `tests/unit/package-entries.test.ts` holds them against the manifest's
 * `exports` map.
 */

/** The entries a project imports, by the name of their file under `dist/`. */
export const LIBRARY_ENTRIES = {
  index: 'src/index.ts',
  client: 'src/client-entry.ts',
  server: 'src/server/index.ts',
  plugin: 'src/server/payload/plugin.ts',
  lexical: 'src/lexical-entry.ts',
  fragment: 'src/runtime/fragment/index.ts',
  codegen: 'src/tools/codegen/index.ts',
  'codegen-astro': 'src/tools/codegen/astro-plugin.ts',
  annotate: 'src/tools/codegen/annotate/entry.ts',
  'adapters/astro/index': 'src/adapters/astro/index.ts',
  'adapters/astro/middleware-entry': 'src/adapters/astro/middleware-entry.ts',
  'adapters/nextjs/index': 'src/adapters/nextjs/index.ts',
  'adapters/sveltekit/index': 'src/adapters/sveltekit/index.ts',
  'adapters/sveltekit/client': 'src/adapters/sveltekit/client.ts',
  'adapters/nuxt/index': 'src/adapters/nuxt/index.ts',
  'adapters/nuxt/client': 'src/adapters/nuxt/client.ts',
  'adapters/vue/index': 'src/adapters/vue/index.ts',
  // Nuxt loads the module by specifier and the plugin it registers by path;
  // nothing in application code imports either.
  'adapters/nuxt/module': 'src/adapters/nuxt/module.ts',
} as const;

/** The two binaries. No exports subpath names them. */
export const CLI_ENTRIES = {
  'codegen-cli': 'src/tools/codegen/cli.ts',
  'doctor-cli': 'src/tools/doctor/cli.ts',
} as const;

/**
 * Entries whose published file must start with a framework directive.
 *
 * The directive cannot live in the source: esbuild drops a module-level one
 * when it bundles, and a `banner` is dropped with it. `scripts/build-dist.ts`
 * therefore writes it back through terser's `preamble`, which also shifts the
 * source map for it. The chunks such an entry imports carry none: the
 * directive marks the boundary, and what it imports belongs to that side.
 */
export const DIRECTIVE_ENTRIES = {
  'adapters/react/index': { source: 'src/adapters/react/index.ts', directive: "'use client';" },
  'adapters/nextjs/client': { source: 'src/adapters/nextjs/client.ts', directive: "'use client';" },
} as const;
