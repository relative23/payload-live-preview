import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import coveragePolicy from './quality/coverage-policy.json' with { type: 'json' };
import { ZeroSkipReporter } from './scripts/zero-skip-reporter';

/**
 * `PLP_PROPERTY_RUNS` multiplies the cases every property explores, so the
 * deadline has to grow with it. Without this the scheduled exploration fails on
 * the clock rather than on a counterexample: the sanitizer property needs ~2.5 s
 * for 10,000 cases here and more than the 5 s default on a slower runner, which
 * is a property of the machine and says nothing about the code.
 */
function propertyExplorationTimeout(): number | undefined {
  const raw = process.env['PLP_PROPERTY_RUNS'];
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const runs = Number(raw);
  if (!Number.isSafeInteger(runs) || runs <= 100) return undefined;
  return Math.min(600_000, 5_000 * Math.ceil(runs / 100));
}

const explorationTimeout = propertyExplorationTimeout();

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    ...(explorationTimeout === undefined ? {} : { testTimeout: explorationTimeout }),
    // The static test policy catches focused tests; this closes the runner-level hatch.
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
        // Type-only; the runtime brand check lives in authorized-preview.ts and is measured.
        'src/types/payload-protocol.ts',
        'src/inline/runtime.generated.ts',
        // Exercised only as a subprocess, which v8 coverage cannot attribute back.
        'src/codegen/cli.ts',
      ],
      thresholds: {
        ...coveragePolicy.global,
        ...coveragePolicy.criticalFiles,
      },
    },
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      // Provided by the integration's Vite plugin in a real build.
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
