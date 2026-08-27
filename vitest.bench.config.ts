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
        // CodSpeed measures deterministic hot paths under instrumentation.
        // The skipUnchanged bench is an integration measurement: it drives the
        // whole runtime and awaits a flush that arrives on
        // requestAnimationFrame, which never fires under the instrumented
        // run — the job hung for six hours until the runner killed it. Its
        // figures are meaningful only with a real event loop, so it lives in
        // `npm run test:bench` and the browser trend, not here.
        exclude: ['tests/benchmarks/skip-unchanged.bench.ts'],
      },
    },
  }),
);
