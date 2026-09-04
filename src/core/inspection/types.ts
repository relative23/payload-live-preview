/**
 * Shape of the `inspect()` snapshot. It only re-reads what the page already
 * shows — origins from the injected script, field names from the DOM,
 * counters derived from both — so it stays available in production, where a
 * misbehaving preview is exactly the case worth diagnosing. Reading one
 * performs no I/O and transmits nothing.
 */
import type { ConnectionStatus } from '../state';

/** Origin trust as the runtime currently sees it. */
export interface InspectionOrigins {
  /** Configured origins; empty means the referrer and localhost heuristics decide instead. */
  readonly trusted: readonly string[];
  /** The origin locked onto by the first accepted update; every other is then refused. */
  readonly locked: string | undefined;
}

/** Protocol versions and the capabilities they enable. */
export interface InspectionProtocol {
  /** This library's protocol version. */
  readonly ours: number;
  /** The remote party's version, or `undefined` if it never announced one. */
  readonly theirs: number | undefined;
  /** `min(ours, theirs ?? 1)` — what both sides actually share. */
  readonly negotiated: number;
  /** Capability flags enabled at the negotiated version. */
  readonly capabilities: readonly string[];
  /** The subset of `capabilities` seen on the wire rather than granted by version. */
  readonly observed: readonly string[];
  /** The Payload profile the observed capabilities imply: `unknown`, `payload-2` or `payload-3`. */
  readonly profile: string;
}

/** Revision accounting for the update pipeline. */
export interface InspectionRevisions {
  /** Updates accepted since the runtime started. */
  readonly accepted: number;
  /**
   * Updates that were still in flight when a newer one arrived and were
   * therefore abandoned. A number that tracks `accepted` closely means the
   * editor is out-typing the pipeline, which is normal; it is only a problem
   * when the last update is among the abandoned ones.
   */
  readonly superseded: number;
  /**
   * Updates whose scheduled writes reached the DOM. What is neither
   * superseded nor completed is in flight or was cancelled; a `superseded`
   * that tracks `accepted` while `completed` stays low is the editor
   * out-typing the pipeline.
   */
  readonly completed: number;
  /**
   * Bindings not scheduled because their value was identical to the one last
   * applied. Cumulative since start; always `0` unless `skipUnchanged` is on.
   * A large number beside a small `accepted` is the optimisation working.
   */
  readonly skippedUnchanged: number;
  /** Revision currently in flight, or `undefined` when the pipeline is idle. */
  readonly active: number | undefined;
}

/** What the DOM offers the runtime to write into. */
export interface InspectionBindings {
  /** Elements carrying a binding. */
  readonly elements: number;
  /** Distinct field names across those elements. */
  readonly fields: number;
  /** Those field names, sorted. */
  readonly fieldNames: readonly string[];
  /**
   * Bound fields some update carried no value for, so the binding kept its old
   * text — why a binding can stay stale while its siblings update. Cumulative.
   */
  readonly absentFields: readonly string[];
  /**
   * Field names that arrived but matched no binding — a markup problem.
   * A name in neither this list nor `fieldNames` was never sent. Cumulative.
   */
  readonly orphanFields: readonly string[];
  /** Whether `scopeBindingsByOwner` is active. */
  readonly ownerScoped: boolean;
  /** Distinct document owners currently on the page, sorted. */
  readonly owners: readonly string[];
}

/** Scheduler work in progress. */
export interface InspectionScheduler {
  /** Writes buffered for the next flush. */
  readonly pending: number;
  /** Writes held back offscreen above `visibilityGateThreshold`; applied when scrolled into view. */
  readonly deferred: number;
  /** The binding count above which the visibility gate starts deferring. */
  readonly visibilityGateThreshold: number;
  /** Whether the binding count is above that threshold right now. */
  readonly visibilityGateActive: boolean;
  /** Stats of the most recent flush, or `undefined` if none has run. */
  readonly lastFlush:
    | {
        readonly applied: number;
        /** Which fields the flush wrote; a count alone cannot say a binding was skipped. */
        readonly appliedFields: readonly string[];
        readonly deferred: number;
        readonly durationMs: number;
      }
    | undefined;
}

/** A point-in-time read; plain values only, with no references into runtime internals. */
export interface LivePreviewInspection {
  /** Package version that produced this snapshot. */
  readonly version: string;
  /** Whether the runtime is started, and whether it has been destroyed. */
  readonly started: boolean;
  /** Connection status as reported to the `connect`/`disconnect` events. */
  readonly status: ConnectionStatus;
  readonly origins: InspectionOrigins;
  readonly protocol: InspectionProtocol;
  readonly revisions: InspectionRevisions;
  readonly bindings: InspectionBindings;
  readonly scheduler: InspectionScheduler;
  /** Field types with a registered renderer, sorted. */
  readonly renderers: readonly string[];
  /** Registered plugins and their live registrations; empty on a bare runtime. */
  readonly plugins: readonly PluginInspection[];
  /** Server-rendered fragment boundaries: whether a handler exists and what happened to renders. */
  readonly fragments: InspectionFragments;
  /** Route refreshes: whether a strategy exists, how many ran, failed, or were stopped by the loop guard. */
  readonly route: InspectionRoute;
}

/** The route strategy as `inspect()` reports it. */
export interface InspectionRoute {
  readonly handler: boolean;
  readonly refreshes: number;
  readonly failed: number;
  /** Second refresh requests for one revision, refused with LP0805. */
  readonly loopStopped: number;
}

/** The fragment strategy as `inspect()` reports it. */
export interface InspectionFragments {
  /** Whether a fragment handler is configured; without one, boundaries are patched. */
  readonly handler: boolean;
  readonly inFlight: number;
  readonly rendered: number;
  readonly failed: number;
  readonly superseded: number;
}

/** One plugin as `inspect().plugins` reports it. */
export interface PluginInspection {
  readonly name: string;
  readonly version: string | undefined;
  /** `initializing` while `init` runs, `active` afterwards, `tearing-down` while `destroy` runs. */
  readonly state: 'initializing' | 'active' | 'tearing-down';
  /** Live registrations owned by the plugin's scope, by kind. */
  readonly registrations: {
    readonly transforms: number;
    readonly renderers: number;
    readonly subscriptions: number;
    readonly cleanups: number;
  };
}
