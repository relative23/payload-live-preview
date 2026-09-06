import { defineConfig, type Options } from 'tsup';

import {
  CORE_ENTRY,
  DIRECTIVE_ENTRIES,
  DUAL_FORMAT_ENTRIES,
  ESM_ONLY_ENTRIES,
  STANDALONE_ENTRIES,
} from './scripts/package-entries';

export { CORE_ENTRY, DIRECTIVE_ENTRIES, DUAL_FORMAT_ENTRIES, ESM_ONLY_ENTRIES, STANDALONE_ENTRIES };

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
  // esbuild only bundles and lowers syntax here. Minification is the terser
  // pass in scripts/build-dist.ts, for two measured reasons: esbuild's minify
  // strips the `/* @__PURE__ */` annotations a consumer's bundler needs to drop
  // what it does not import, and esbuild's `keepNames` is implemented with
  // top-level statements that bundler cannot prove pure — with it, one symbol
  // imported from the root barrel shipped the whole bundle
  // (scripts/check-tree-shaking.ts).
  minify: false,
  keepNames: false,
  treeshake: true,
  target: 'es2022',
  outDir: 'dist',
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // ts-morph is huge — never inline it. Codegen consumers install it
  // themselves via the peerDependencies declaration. The virtual
  // module is resolved by the consumer's Vite (integration plugin).
  // `svelte/server` is an optional peer written as a real specifier (see
  // src/adapters/sveltekit/fragments.ts on why that one cannot be hidden behind
  // a variable); `react` and `vue` are the optional peers the `./react` and
  // `./vue` entries import statically, because a hook cannot be lazy. All are
  // named external so the build never inlines them — a consumer resolves its
  // own copy.
  external: ['ts-morph', 'react', 'svelte/server', 'vue', /^virtual:/],
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
  ...Object.entries(STANDALONE_ENTRIES).map(([name, source]): Options => ({
    ...SHARED_OPTIONS,
    name,
    entry: { [name]: source },
    format: ['esm', 'cjs'],
  })),
  {
    ...SHARED_OPTIONS,
    name: 'core',
    entry: CORE_ENTRY,
    format: ['esm', 'cjs'],
  },
  {
    ...SHARED_OPTIONS,
    name: 'esm-only',
    entry: {
      ...ESM_ONLY_ENTRIES,
      // Their directive is not a build option: esbuild drops both a source
      // directive and a banner, so `scripts/build-dist.ts` writes it back.
      ...Object.fromEntries(
        Object.entries(DIRECTIVE_ENTRIES).map(([name, entry]) => [name, entry.source]),
      ),
    },
    format: ['esm'],
  },
];

export default defineConfig(BUILD_PROFILES);
