import type { Parameters } from 'fast-check';

const DEFAULT_RUNS = 100;

function readSafeInteger(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || !/^-?\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Deterministic fast-check parameters for PR tests.
 *
 * A failing assertion always reports its seed and shrink path. Keeping a fixed
 * seed makes the ordinary suite reproducible. A scheduled job can rotate
 * PLP_PROPERTY_SEED and persist it with its logs; setting the same value locally
 * replays that generated stream. PLP_PROPERTY_RUNS increases exploration without
 * creating a second test corpus.
 */
export function propertyParameters(
  seed: number,
  defaultRuns = DEFAULT_RUNS,
): Pick<Parameters, 'seed' | 'numRuns'> {
  const configuredSeed = readSafeInteger('PLP_PROPERTY_SEED');
  const configuredRuns = readSafeInteger('PLP_PROPERTY_RUNS');
  return {
    seed: configuredSeed ?? seed,
    numRuns: configuredRuns !== undefined && configuredRuns > 0 ? configuredRuns : defaultRuns,
  };
}
