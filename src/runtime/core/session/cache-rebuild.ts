/**
 * The scan of the page for bindings, and the scan after the page changed: a
 * rebuild keeps the work buffered for a binding that is still the same, and
 * hands what is new on the page back to be applied.
 */

import { hasSameBindingIdentity } from '../bindings/cache';
import type { CachedElement } from '../types';
import type { UpdatePipeline } from '../update/update-pipeline';
import type { RuntimeDeps, RuntimeState } from './runtime-state';

/** Scan the page for bindings and hand each element to the observers. */
export function buildCacheAndObserve(deps: RuntimeDeps, state: RuntimeState): void {
  if (!state.isRunning()) return;
  const stats = deps.cache.buildFromRoot(deps.root);
  deps.log('cache', stats);
  if (!state.isRunning()) return;
  void deps.emitter.emitWhile('cacheRefresh', stats, () => state.isRunning());
  if (!state.isRunning()) return;
  for (const entry of deps.cache.values()) {
    if (!state.isRunning()) return;
    deps.observers.observeElement(entry.element);
  }
}

/** Scan again: buffered work survives on a binding that is still the same, and what is new is applied. */
export function rebuildCache(
  deps: RuntimeDeps,
  state: RuntimeState,
  pipeline: UpdatePipeline,
): void {
  if (!state.isRunning()) return;
  const previous = new Map<Element, CachedElement>();
  const previousIslandOwners = deps.cache.islandOwners;
  const previousNavigationRoots = new Set(deps.cache.navigationReplayRoots);
  for (const entry of deps.cache.values()) {
    previous.set(entry.element, entry);
    deps.observers.unobserveElement(entry.element);
  }
  buildCacheAndObserve(deps, state);
  if (!state.isRunning()) return;
  const added = new Set<Element>(
    deps.cache.navigationReplayRoots.filter((root) => !previousNavigationRoots.has(root)),
  );
  // Buffered work survives only while the same element is bound to the same field.
  for (const entry of deps.cache.values()) {
    const before = previous.get(entry.element);
    if (before !== undefined && hasSameBindingIdentity(before, entry)) {
      deps.scheduler.retarget(entry);
    } else {
      deps.scheduler.forget(entry.element);
      // Its stamp was written for another binding, or by nobody: the value is written again.
      state.lastAppliedIdentity.delete(entry.element);
      added.add(entry.element);
    }
    previous.delete(entry.element);
  }
  for (const removed of previous.values()) deps.scheduler.forget(removed.element);
  if (added.size > 0) pipeline.reapplyNavigationBindings(added);
  const addedIslands = deps.cache.islands.filter(
    (island) =>
      !previousIslandOwners.has(island) ||
      (deps.scopeBindingsByOwner &&
        previousIslandOwners.get(island) !== deps.cache.islandOwners.get(island)),
  );
  if (addedIslands.length > 0) pipeline.reapplyNavigationIslands(addedIslands);
}
