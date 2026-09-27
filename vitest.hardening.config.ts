/**
 * Runs focused handoff characterizations against the current source tree
 * without adding them to the normal regression inventory. Implemented batches
 * also carry normal red/green tests; this file tracks their current result.
 */

import { defineConfig } from 'vitest/config';
import repositoryConfig from './vitest.config';
import { ZeroSkipReporter } from './scripts/zero-skip-reporter';

export default defineConfig({
  ...repositoryConfig,
  test: {
    environment: 'jsdom',
    globals: false,
    allowOnly: false,
    retry: 0,
    reporters: ['default', new ZeroSkipReporter()],
    include: [
      'tests/reproductions/current-source.characterization.ts',
      'tests/reproductions/preview-continuation.package.characterization.ts',
      'tests/reproductions/fragment-island-delivery.characterization.ts',
    ],
    exclude: ['tests/e2e/**', 'tests/benchmarks/**', 'node_modules', '.archive', 'dist'],
    coverage: { enabled: false },
    setupFiles: ['tests/setup.ts'],
  },
});
