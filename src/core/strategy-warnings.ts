/**
 * The warnings about a page's strategies, kept apart from the runner that
 * usually issues them: the lean profile has no runner (see ./profile) and still
 * owes a page the first two, because they describe the markup, not the strategy
 * machinery. LP0808 says the configuration names no strategy at all, and LP0809
 * that a fragment's Astro island cannot start on this page.
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

/**
 * LP0808, once: the default asks for a server render and this page has nothing
 * to ask. Said with the count that brought it up: a page that keeps producing
 * findings is the page that needs the line, not one line per finding. A page
 * with a fragment strategy and no route reaches here too, when no boundary
 * covers the field, and is told that rather than that nothing is configured.
 */
export function warnEscalationUnavailable(
  deps: RuntimeDeps,
  state: RuntimeState,
  count: number,
): void {
  if (state.warnedEscalationUnavailable) return;
  state.warnedEscalationUnavailable = true;
  const shortfall = `[live-preview] LP0808: onUnfaithfulPatch: 'escalate' has nowhere to go: ${String(count)} field(s) fell short`;
  const warnInstead = "or onUnfaithfulPatch: 'warn' to keep the patch and say so.";
  deps.warn(
    deps.strategies.fragment === undefined
      ? `${shortfall} and no route or fragment strategy is configured. Set routeStrategy: true or fragments: { endpoint }, ${warnInstead}`
      : `${shortfall} outside every data-payload-fragment boundary, and no route strategy is configured. ` +
          `Cover them with a boundary or add the route strategy, ${warnInstead}`,
  );
}

/** LP0809, once: fragment scripts never run, so the page must already start Astro islands. */
export function warnIslandStart(
  deps: RuntimeDeps,
  state: RuntimeState,
  island: Element,
  blocker: 'element' | 'directive',
): void {
  if (state.warnedIslandStart) return;
  state.warnedIslandStart = true;
  const missing =
    blocker === 'element' ? '<astro-island>' : `client:${island.getAttribute('client') ?? ''}`;
  deps.warn(
    `[live-preview] LP0809: a fragment island cannot start: this page never loaded ${missing}; render one on the page`,
  );
}
