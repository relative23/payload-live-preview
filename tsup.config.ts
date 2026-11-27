import { defineConfig, type Options } from 'tsup';

import { chunkBoundaries } from './scripts/chunk-boundaries';
import { CLI_ENTRIES, DIRECTIVE_ENTRIES, LIBRARY_ENTRIES } from './scripts/package-entries';

export { CLI_ENTRIES, DIRECTIVE_ENTRIES, LIBRARY_ENTRIES };

/** What a project imports or runs: the entries that get a file and declarations. */
const ENTRIES = {
  ...LIBRARY_ENTRIES,
  ...CLI_ENTRIES,
  // Their directive is not a build option: esbuild drops both a source
  // directive and a banner, so `scripts/build-dist.ts` writes it back.
  ...Object.fromEntries(
    Object.entries(DIRECTIVE_ENTRIES).map(([name, entry]) => [name, entry.source]),
  ),
};

const SHARED_OPTIONS = {
  // The boundary entries below have no file in the package, so no declarations either.
  dts: { entry: ENTRIES },
  // One graph: a module two entries share is emitted once, as a chunk both import.
  splitting: true,
  sourcemap: true,
  // `scripts/build-dist.ts` cleans `dist` once, before the build; a watch build
  // must not empty the folder the generated assets were copied into.
  clean: false,
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
  // ts-morph is huge — never inline it. Codegen consumers install it
  // themselves via the peerDependencies declaration. The virtual
  // module is resolved by the consumer's Vite (integration plugin).
  // `svelte/server` is an optional peer written as a real specifier (see
  // src/adapters/sveltekit/fragments.ts on why that one cannot be hidden behind
  // a variable); `react` and `vue` are the optional peers the `./react` and
  // `./vue` entries import statically, because a hook cannot be lazy, and
  // `svelte` and `next/navigation` are what the `*/client` navigation entries
  // import for the same reason. All are named external so the build never
  // inlines them — a consumer resolves its own copy.
  // The internal template is copied verbatim; only the consumer's Astro compiler
  // can turn it into a component compatible with that consumer's Astro version.
  external: [
    'ts-morph',
    'react',
    'svelte',
    'svelte/server',
    'vue',
    'next/navigation',
    /^virtual:/,
    './FragmentBridge.astro',
  ],
  tsconfig: 'tsconfig.json',
} satisfies Options;

/**
 * The package build: one ESM profile for every entry. `npm run build` runs it
 * through `scripts/build-dist.ts`, which cleans `dist` once and minifies the
 * output; the exported config keeps ad-hoc and watch builds on the same entries.
 */
export const BUILD_PROFILES: Options[] = [
  {
    ...SHARED_OPTIONS,
    name: 'package',
    // A module that defines a public name is an entry too, for the chunk boundary alone
    // (scripts/chunk-boundaries.ts); `scripts/build-dist.ts` removes its file.
    entry: { ...ENTRIES, ...chunkBoundaries() },
    format: ['esm'],
  },
];

export default defineConfig(BUILD_PROFILES);
