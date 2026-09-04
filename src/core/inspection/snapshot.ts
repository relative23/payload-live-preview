/** Assembles the `inspect()` snapshot. Reads state only; sends nothing anywhere. */

import { VERSION } from '../../version';
import { detectProtocolProfile } from '../protocol-profile';
import type { RuntimeDeps, RuntimeState } from '../runtime-state';
import type { LivePreviewInspection } from './types';

export function buildInspection(deps: RuntimeDeps, state: RuntimeState): LivePreviewInspection {
  const { cache, scheduler } = deps;
  const negotiation = state.protocol.negotiation;
  const active = state.activeUpdate;
  const flush = state.lastFlush;
  const fieldNames: string[] = [];
  const owners = new Set<string>();
  for (const [fieldName, bindings] of cache.entries()) {
    fieldNames.push(fieldName);
    for (const binding of bindings) {
      if (binding.owner !== undefined) owners.add(binding.owner);
    }
  }
  return {
    version: VERSION,
    started: state.started,
    status: deps.connection.status,
    origins: { trusted: [...deps.readyTargets()], locked: deps.lockedOrigin() },
    protocol: {
      ours: negotiation.ours,
      theirs: negotiation.theirs,
      negotiated: negotiation.negotiated,
      capabilities: [...negotiation.capabilities].sort(),
      observed: [...negotiation.observed].sort(),
      profile: detectProtocolProfile(negotiation.observed).name,
    },
    revisions: {
      accepted: state.updateCount,
      superseded: state.supersededCount,
      completed: state.completedCount,
      skippedUnchanged: state.skippedUnchangedCount,
      active: active === null ? undefined : active.identity.revision,
    },
    bindings: {
      elements: cache.elementCount,
      fields: cache.fieldCount,
      fieldNames: fieldNames.sort(),
      absentFields: [...state.absentFields].sort(),
      orphanFields: [...state.warnedOrphanFields].sort(),
      ownerScoped: deps.scopeBindingsByOwner,
      owners: [...owners].sort(),
    },
    route: { handler: deps.strategies.route !== undefined, ...state.routeStats },
    fragments: {
      handler: deps.strategies.fragment !== undefined,
      inFlight: active?.pendingFragments ?? 0,
      ...state.fragmentStats,
    },
    scheduler: {
      pending: scheduler.pendingCount,
      deferred: scheduler.replayCount,
      visibilityGateThreshold: scheduler.gateThreshold,
      visibilityGateActive: scheduler.gateActive,
      lastFlush:
        flush === null
          ? undefined
          : {
              applied: flush.applied,
              appliedFields: flush.appliedFields,
              deferred: flush.deferred,
              durationMs: flush.durationMs,
            },
    },
    plugins: [],
    renderers: Object.keys(deps.renderers).sort(),
  };
}
