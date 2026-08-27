import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import coveragePolicy from './quality/coverage-policy.json' with { type: 'json' };
import { ZeroSkipReporter } from './scripts/zero-skip-reporter';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    // Focused tests are never an acceptable local or CI success: the static
    // test policy catches them before execution and this closes the runner-level
    // escape hatch as well.
    allowOnly: false,
    retry: 0,
    reporters: ['default', new ZeroSkipReporter()],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'tests/benchmarks/**', 'node_modules', '.archive', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',
        'src/**/index.ts',
        'src/**/types.ts',
        // Type-only protocol module. `src/types/authorized-preview.ts` carries
        // the runtime brand check and is measured like any other source file.
        'src/types/payload-protocol.ts',
        'src/inline/runtime.generated.ts',
        // Build-time tooling, not shipped runtime code. It is exercised
        // end-to-end (CLI subprocess + ts-morph program tests), but v8
        // coverage cannot attribute subprocess execution to these files.
        // The thresholds below police the shipped browser/server runtime.
        'src/codegen/**',
      ],
      // The checked-in policy is shared with the diff gate. Global thresholds
      // retain broad pressure while exact critical-file thresholds protect the
      // security/revision/lifecycle paths at their measured baseline.
      thresholds: {
        ...coveragePolicy.global,
        ...coveragePolicy.criticalFiles,
      },
    },
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      // Provided by the integration's Vite plugin in a real build; a
      // fixture here so the middleware entry can be imported and measured.
      'virtual:payload-live-preview/options': resolve(
        import.meta.dirname,
        'tests/fixtures/astro-virtual-options.ts',
      ),
      '@': resolve(import.meta.dirname, 'src'),
      '@core': resolve(import.meta.dirname, 'src/core'),
      '@security': resolve(import.meta.dirname, 'src/security'),

      '@fragment': resolve(import.meta.dirname, 'src/fragment'),

      '@migrate': resolve(import.meta.dirname, 'src/migrate'),
      '@lexical': resolve(import.meta.dirname, 'src/lexical'),
      '@schema': resolve(import.meta.dirname, 'src/schema'),
      '@field-types': resolve(import.meta.dirname, 'src/field-types'),
      '@detection': resolve(import.meta.dirname, 'src/detection'),
      '@events': resolve(import.meta.dirname, 'src/events'),
      '@plugins': resolve(import.meta.dirname, 'src/plugins'),
      '@inline': resolve(import.meta.dirname, 'src/inline'),
      '@client': resolve(import.meta.dirname, 'src/client'),
      '@adapters': resolve(import.meta.dirname, 'src/adapters'),
      '@doctor': resolve(import.meta.dirname, 'src/doctor'),
      '@types': resolve(import.meta.dirname, 'src/types'),
      '@dsl': resolve(import.meta.dirname, 'src/dsl'),
    },
  },
});
