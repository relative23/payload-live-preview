import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core-entry.ts',
    codegen: 'src/codegen/index.ts',
    'codegen-cli': 'src/codegen/cli.ts',
    'codegen-astro': 'src/codegen/astro-plugin.ts',
    'adapters/astro/index': 'src/adapters/astro/index.ts',
    'adapters/nextjs/index': 'src/adapters/nextjs/index.ts',
    'adapters/sveltekit/index': 'src/adapters/sveltekit/index.ts',
    'adapters/nuxt/index': 'src/adapters/nuxt/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: 'es2022',
  outDir: 'dist',
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // ts-morph is huge — never inline it. Codegen consumers install it
  // themselves via the peerDependencies declaration.
  external: ['ts-morph'],
  tsconfig: 'tsconfig.json',
});
