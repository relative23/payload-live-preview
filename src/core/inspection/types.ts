/**
 * The shape of a live-preview inspection snapshot.
 *
 * This module is types only. The snapshot is assembled by
 * `LivePreviewRuntime.inspect()` as a plain object literal, because the inline
 * runtime pays for every byte of indirection and the assembly needs access to
 * internal state the runtime does not otherwise expose.
 *
 * A snapshot is a read of what the runtime already holds. It discloses nothing
 * that is not already observable on the page: the trusted origins are inside
 * the injected script, the field names are `data-payload-field` attributes in
 * the DOM, and the counters are derived from those. It is therefore available
 * in production rather than gated to development builds — a preview that
 * misbehaves only on the deployed site is exactly the case where the
 * information is worth having, and a development-only gate would withhold it
 * there.
 *
 * Nothing here is transmitted anywhere. Reading a snapshot performs no I/O.
 *
 * @module @core/inspection/types
 */
import type { ConnectionStatus } from '../state';

/** Origin trust as the runtime currently sees it. */
export interface InspectionOrigins {
  /**
   * Origins the runtime is willing to accept messages from, as configured.
   * An empty list means no explicit allow-list was given, which is the
   * condition under which referrer and localhost heuristics decide instead.
   */
  readonly trusted: readonly string[];
  /**
   * The origin the runtime locked onto after its first accepted update, or
   * `undefined` while still unlocked. Once locked, every other origin is
   * refused for the rest of the session.
   */
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
   * Field names that arrived in an update but matched no binding, as far as
   * the runtime has observed. This is the list to read when a field refuses
   * to update: a name here is a markup problem, a name absent from here and
   * from `fieldNames` was never sent.
   */
  /**
   * Bound fields that some update since start carried no value for, so the
   * binding kept whatever text it already had. Cumulative, like
   * `orphanFields`, and the exact opposite of it: a binding with no value
   * rather than a value with no binding.
   *
   * This is why a binding can stay stale while its siblings update. Without
   * it the two cases are indistinguishable from the DOM, since neither
   * leaves a trace.
   */
  readonly absentFields: readonly string[];
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
  /**
   * Writes held back because their element is offscreen and the binding count
   * is above `visibilityGateThreshold`. These are applied when the element
   * scrolls into view — never, on a page nobody scrolls.
   */
  readonly deferred: number;
  /** The binding count above which the visibility gate starts deferring. */
  readonly visibilityGateThreshold: number;
  /** Whether the binding count is above that threshold right now. */
  readonly visibilityGateActive: boolean;
  /** Stats of the most recent flush, or `undefined` if none has run. */
  readonly lastFlush:
    | {
        readonly applied: number;
        readonly deferred: number;
        readonly durationMs: number;
      }
    | undefined;
}

/**
 * A point-in-time read of runtime state, for diagnosing a preview that is not
 * behaving. Every field is a plain value; the snapshot holds no references
 * into runtime internals and does not change after it is returned.
 */
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
}
