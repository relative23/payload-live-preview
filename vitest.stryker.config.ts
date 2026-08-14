import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

const base = baseConfig;

/**
 * Stryker intentionally executes related tests and later test subsets per
 * mutant. The ordinary zero-skip reporter is a whole-suite CI invariant and
 * would misclassify those selective executions as user-authored skips.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    reporters: ['default'],
  },
});
