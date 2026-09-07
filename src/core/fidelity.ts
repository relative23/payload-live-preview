/**
 * What the runtime does about a patch it knows will not reach what the server
 * would have drawn: a renderer that refused the value, a Lexical block whose
 * markup the write had to drop. The finding is made where the write happens;
 * the policy and the ledger live here, so the pipeline can hand the region to a
 * strategy once the flush is over instead of leaving the page worse off.
 *
 * A changed field with no binding at all is the same judgement made one step
 * earlier — there is no element to write to — and `StrategyRunner` reaches it
 * from `unbound-fields.ts` before anything is scheduled.
 */

import type { RuntimeDeps, RuntimeState } from './runtime-state';
import type { CachedElement } from './types';

/**
 * `'ignore'` keeps the degraded patch, which is what 2.0 shipped under the
 * name `onUnboundChange: 'ignore'`. `'warn'` keeps it and says so (LP0411).
 * `'escalate'`, the default, asks a server to draw the region instead: the
 * fragment strategy when a boundary covers the binding, the route otherwise.
 *
 * Without a strategy to escalate to, every mode keeps the patch. A page that
 * cannot ask a server for better markup is not helped by being told twice.
 */
export type UnfaithfulPatchMode = 'ignore' | 'warn' | 'escalate';

/**
 * Both spellings of the option; the 2.0 name stays until 3.0. Explicitly
 * `| undefined`, because one caller reads them out of the inline script's
 * positional tuple, where an omitted slot is exactly that.
 */
export interface UnfaithfulPatchOptions {
  readonly onUnfaithfulPatch?: UnfaithfulPatchMode | undefined;
  readonly onUnboundChange?: 'ignore' | 'route' | undefined;
}

/**
 * The 2.0 name maps onto the new one without loss: `'route'` was this option's
 * escalation and `'ignore'` its opt-out. Only an omitted option takes the new
 * default — a project that wrote `'ignore'` down chose it, and keeps it.
 */
export function resolveUnfaithfulPatchMode(options: UnfaithfulPatchOptions): UnfaithfulPatchMode {
  // `'ignore'` is the only thing the old name can still say that the new
  // default does not: its `'route'` and its absence both mean escalate now.
  return (
    options.onUnfaithfulPatch ?? (options.onUnboundChange === 'ignore' ? 'ignore' : 'escalate')
  );
}

/**
 * Record one binding this revision could not patch faithfully, and queue it for
 * the escalation the flush will run.
 *
 * Once per element, for the same reason every other diagnostic here is: the
 * cause is the markup or the value's shape, so the next message would report
 * the same thing. Under `'escalate'` that also stops a value the renderer keeps
 * refusing from becoming one route refresh per keystroke.
 */
export function reportUnfaithfulPatch(
  deps: RuntimeDeps,
  state: RuntimeState,
  target: CachedElement,
  reason: string,
): void {
  const mode = deps.onUnfaithfulPatch;
  if (mode === 'ignore' || state.reportedUnfaithful.has(target.element)) return;
  state.reportedUnfaithful.add(target.element);
  if (mode === 'warn') {
    deps.warn(`[live-preview] LP0411: "${target.fieldName}" ${reason}`);
    return;
  }
  deps.log('LP0411', target.fieldName, reason);
  state.unfaithfulPatches.push(target);
}
