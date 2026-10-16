/**
 * Keep the original Next caller's entry point while sharing clean installation.
 * Framework selection belongs to the runner, not to browser-supplied input.
 */
import { startNativeContinuation } from './native-continuation';

export function startNextContinuation(
  artifact: string,
  baseline = false,
): ReturnType<typeof startNativeContinuation> {
  return startNativeContinuation(artifact, 'next', baseline);
}
