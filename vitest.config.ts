import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
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
        'src/adapters/**',
        'src/types/**',
        'src/inline/runtime.generated.ts',
        // Type-only interface module (no executable statements).
        'src/client/config.ts',
        // Build-time tooling, not shipped runtime code. It is exercised
        // end-to-end (CLI subprocess + ts-morph program tests), but v8
        // coverage cannot attribute subprocess execution to these files.
        // The thresholds below police the shipped browser/server runtime.
        'src/codegen/**',
      ],
      // Baselined under vitest 4's stricter V8 remapping (2026-07):
      // 95.7 lines / 92.8 stmts / 85.3 branches / 94.3 funcs measured.
      // The uncovered remainder is inline-runtime + SSR-fallback code
      // that is exercised in production but hard to drive from jsdom
      // (defaultSendReady's window detection, view-transitions support
      // probing, etc.). The security-critical modules remain at 100%.
      thresholds: {
        lines: 95,
        functions: 94,
        branches: 85,
        statements: 92,
      },
    },
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@security': resolve(__dirname, 'src/security'),
      '@lexical': resolve(__dirname, 'src/lexical'),
      '@schema': resolve(__dirname, 'src/schema'),
      '@field-types': resolve(__dirname, 'src/field-types'),
      '@detection': resolve(__dirname, 'src/detection'),
      '@events': resolve(__dirname, 'src/events'),
      '@plugins': resolve(__dirname, 'src/plugins'),
      '@inline': resolve(__dirname, 'src/inline'),
      '@client': resolve(__dirname, 'src/client'),
      '@adapters': resolve(__dirname, 'src/adapters'),
      '@types': resolve(__dirname, 'src/types'),
      '@dsl': resolve(__dirname, 'src/dsl'),
    },
  },
});
