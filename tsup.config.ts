import { defineConfig, type Options } from 'tsup';

export const DUAL_FORMAT_ENTRIES = {
  index: 'src/index.ts',
  codegen: 'src/codegen/index.ts',
  payload: 'src/payload/index.ts',
} as const;

export const CORE_ENTRY = {
  core: 'src/core-entry.ts',
} as const;

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

const SHARED_OPTIONS = {
  dts: true,
  splitting: false,
  sourcemap: true,
  // `scripts/build-dist.ts` owns the single clean operation before running these
  // profiles sequentially. Keeping profile-local cleaning disabled prevents one
  // profile from deleting the other profile's output.
  clean: false,
  // Published entries are parsed and transferred by every consumer. Full
  // esbuild minification cuts that cost substantially; `keepNames` preserves
  // observable class/function names used by diagnostics and existing code.
  minify: true,
  keepNames: true,
  treeshake: true,
  target: 'es2022',
  outDir: 'dist',
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // ts-morph is huge — never inline it. Codegen consumers install it
  // themselves via the peerDependencies declaration. The virtual
  // module is resolved by the consumer's Vite (integration plugin).
  external: ['ts-morph', /^virtual:/],
  tsconfig: 'tsconfig.json',
} satisfies Options;

/**
 * Package build profiles. Only manifest entries with a `require` condition emit
 * CommonJS JavaScript, source maps, and declarations.
 *
 * `npm run build` executes these profiles sequentially through
 * `scripts/build-dist.ts`. The exported config also keeps ad-hoc/watch builds on
 * the same entry/format contract; neither profile performs destructive cleaning.
 */
export const BUILD_PROFILES: Options[] = [
  {
    ...SHARED_OPTIONS,
    name: 'dual-format',
    entry: DUAL_FORMAT_ENTRIES,
    format: ['esm', 'cjs'],
  },
  {
    ...SHARED_OPTIONS,
    name: 'core',
    entry: CORE_ENTRY,
    format: ['esm', 'cjs'],
    // The core entry contains a large internal runtime graph. Preserving every
    // internal symbol name makes that graph materially larger, while only its
    // exported function/class names are observable. `scripts/build-dist.ts`
    // retains that exact public allow-list during the final minification pass.
    keepNames: false,
    minify: false,
  },
  {
    ...SHARED_OPTIONS,
    name: 'esm-only',
    entry: ESM_ONLY_ENTRIES,
    format: ['esm'],
  },
];

export default defineConfig(BUILD_PROFILES);
