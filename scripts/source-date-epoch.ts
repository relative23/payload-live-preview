/** Resolve the generated-runtime timestamp without changing its public shape. */

const SOURCE_DATE_EPOCH_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

/**
 * Convert the reproducible-build epoch to the existing ISO timestamp contract.
 * Local builds without SOURCE_DATE_EPOCH keep the useful wall-clock fallback.
 */
export function buildGeneratedAt(
  environment: Readonly<NodeJS.ProcessEnv>,
  now: () => Date = () => new Date(),
): string {
  const sourceDateEpoch = environment['SOURCE_DATE_EPOCH'];
  if (sourceDateEpoch === undefined) return now().toISOString();
  if (!SOURCE_DATE_EPOCH_PATTERN.test(sourceDateEpoch)) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer number of seconds');
  }

  const seconds = Number(sourceDateEpoch);
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(milliseconds)) {
    throw new Error('SOURCE_DATE_EPOCH is outside the supported Date range');
  }

  const generatedAt = new Date(milliseconds);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error('SOURCE_DATE_EPOCH is outside the supported Date range');
  }
  return generatedAt.toISOString();
}
