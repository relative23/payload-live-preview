import codspeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * Benchmark-only Vitest configuration.
 *
 * Locally the CodSpeed plugin deliberately falls back to Vitest's normal
 * benchmark runner. In the scheduled CodSpeed workflow the same benchmark
 * sources are instrumented, so local investigation and historical CI trends
 * cannot silently drift into two different harnesses.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [codspeedPlugin()],
    test: {
      benchmark: {
        include: ['tests/benchmarks/**/*.bench.ts'],
      },
    },
  }),
);
