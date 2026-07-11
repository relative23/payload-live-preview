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
        // Field-renderer registry is a thin map; fully exercised by lifecycle tests in Phase 10.
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        // 88% reflects coverage including the inline-runtime + SSR-fallback
        // branches that are exercised in production but hard to drive
        // from jsdom (defaultSendReady's window detection, view-transitions
        // API support detection, etc.). The security-critical modules
        // remain at 100%.
        branches: 88,
        statements: 95,
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
