/**
 * The package's build entries, kept apart from `tsup.config.ts` so tests and
 * gates can read them without loading tsup. `tsup.config.ts` turns them into
 * build profiles; `tests/unit/package-entries.test.ts` holds them against the
 * manifest's `exports` map.
 *
 * @module scripts/package-entries
 */

/** Entries built as ESM and CommonJS in one profile. */
export const DUAL_FORMAT_ENTRIES = {
  index: 'src/index.ts',
  codegen: 'src/codegen/index.ts',
  payload: 'src/payload/index.ts',
} as const;

/**
 * Focused public entries (roadmap 1.4.0, package topology). Each is built
 * alone: they share modules with the root entry, and one profile for several
 * of them would make tsup emit a shared declaration chunk whose file the
 * declaration-parity gate rightly refuses. One profile per entry keeps every
 * `<entry>.d.ts` self-contained.
 */
export const STANDALONE_ENTRIES = {
  server: 'src/server/index.ts',
  client: 'src/client-entry.ts',
  structural: 'src/structural-entry.ts',
  lexical: 'src/lexical-entry.ts',
  plugins: 'src/plugins-entry.ts',
  fragment: 'src/fragment/index.ts',
} as const;

/** The lighter runtime entry; built unminified so consumers' bundlers tree-shake it. */
export const CORE_ENTRY = {
  core: 'src/core-entry.ts',
} as const;

/** ESM-only entries: CLIs, the doctor, the codegen integration and the framework adapters. */
export const ESM_ONLY_ENTRIES = {
  'codegen-cli': 'src/codegen/cli.ts',
  'doctor-cli': 'src/doctor/cli.ts',
  doctor: 'src/doctor/index.ts',
  'codegen-astro': 'src/codegen/astro-plugin.ts',
  'adapters/astro/index': 'src/adapters/astro/index.ts',
  'adapters/astro/middleware-entry': 'src/adapters/astro/middleware-entry.ts',
  'adapters/nextjs/index': 'src/adapters/nextjs/index.ts',
  'adapters/sveltekit/index': 'src/adapters/sveltekit/index.ts',
  'adapters/nuxt/index': 'src/adapters/nuxt/index.ts',
} as const;
