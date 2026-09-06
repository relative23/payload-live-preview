/**
 * The two warnings a binding's strategy can produce, kept apart from the runner
 * that usually issues them: the lean profile has no runner (see ./profile) and
 * still owes a page these answers, because both describe the markup, not the
 * strategy machinery.
 */

import type { RuntimeDeps, RuntimeState } from './runtime-state';
import type { CachedElement } from './types';

/** LP0806, once: a fragment boundary with no handler is patched instead. */
export function warnFragmentFallback(
  deps: RuntimeDeps,
  state: RuntimeState,
  target: CachedElement,
): void {
  if (state.warnedFragmentFallback) return;
  state.warnedFragmentFallback = true;
  deps.warn(
    `[live-preview] LP0806: "${target.fieldName}" asks for the fragment strategy but no handler is configured; patching instead`,
  );
}

/** LP0407, once per element: an unknown strategy is left alone, not guessed at. */
export function warnUnsupportedStrategy(
  deps: RuntimeDeps,
  state: RuntimeState,
  target: CachedElement,
): void {
  if (state.warnedStrategy.has(target.element)) return;
  state.warnedStrategy.add(target.element);
  deps.warn(
    `[live-preview] LP0407: "${target.fieldName}" asks for strategy "${String(target.strategy)}"; only patch, fragment and route exist`,
  );
}
