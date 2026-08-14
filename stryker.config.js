import { readFileSync } from 'node:fs';

const scope = process.env['STRYKER_SCOPE'] ?? 'pr';

if (scope !== 'pr' && scope !== 'nightly') {
  throw new Error(`Unknown STRYKER_SCOPE "${scope}"; expected "pr" or "nightly"`);
}

const prMutate = [
  'src/security/csp.ts',
  'src/security/url-validator.ts',
  'src/core/field-value.ts',
];

const coveragePolicy = JSON.parse(
  readFileSync(new URL('./quality/coverage-policy.json', import.meta.url), 'utf8'),
);
const criticalFiles = Object.keys(coveragePolicy.criticalFiles ?? {});
const nightlyMutate = [...new Set([...criticalFiles, ...prMutate, 'src/core/a11y.ts'])];

export default {
  mutate: scope === 'nightly' ? nightlyMutate : prMutate,
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.stryker.config.ts',
    related: true,
  },
  coverageAnalysis: 'perTest',
  concurrency: 4,
  timeoutMS: 10_000,
  cleanTempDir: 'always',
  // CI and baselines are full runs. Local repeat runs can opt into the cache.
  incremental: process.env['STRYKER_INCREMENTAL'] === '1',
  incrementalFile: `test-results/stryker-${scope}-incremental.json`,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: {
    fileName: `test-results/stryker-${scope}.json`,
  },
  htmlReporter: {
    fileName: `test-results/stryker-${scope}.html`,
  },
  thresholds:
    scope === 'pr'
      ? {
          high: 95,
          low: 90,
          break: 90,
        }
      : {
          // The report policy applies the exact reviewed ratchet. This lower
          // Stryker-native floor still fails early if that policy step is ever
          // accidentally omitted by an ad-hoc runner.
          high: 75,
          low: 70,
          break: 70,
        },
};
