/**
 * Update scheduler — debounce + RAF batching + offscreen replay.
 *
 * The scheduler is the heart of the update pipeline:
 *
 *   1. Incoming updates are debounced. Rapid typing in the admin
 *      panel collapses into a single DOM write per debounce window.
 *   2. After the debounce, the actual writes run inside
 *      `requestAnimationFrame` so they batch with the browser's
 *      paint cycle.
 *   3. Elements that are not currently within the viewport are not
 *      written — their *latest* value is stored in a per-element
 *      replay buffer. When the element becomes visible, the buffered
 *      value is applied. This fixes the stale-offscreen-content bug
 *      from the legacy implementation.
 *
 * The scheduler does not touch the DOM directly. It calls an injected
 * `applyUpdate(target, value)` function so renderer dispatch lives
 * outside this module, keeping the scheduler dependency-free and
 * easily testable.
 *
 * @module @core/update-scheduler
 */

import type { CachedElement } from './types';
import type { MessageRevision } from './message-bus';
import type { PayloadLivePreviewData } from '@/types/payload-protocol';
import { usesNoWriteOutcome } from './internal-outcome';

export interface ScheduledUpdate {
  readonly target: CachedElement;
  readonly value: unknown;
  readonly allFields: Record<string, unknown>;
  /** Lifecycle identity. Runtime-produced entries always include this. */
  readonly identity?: MessageRevision | undefined;
  /** Stable merged-or-fallback snapshot associated with `identity`. */
  readonly data?: PayloadLivePreviewData | undefined;
}

/**
 * Function the scheduler invokes to apply a single update.
 *
 * Renderer dispatch and any sanitization happens inside this callback;
 * the scheduler is intentionally ignorant of field types.
 */
export type ApplyUpdate = (update: ScheduledUpdate) => void;

export interface UpdateSchedulerOptions {
  /** Debounce window in ms. Default: 50. */
  readonly debounceMs?: number;
  /**
   * Visibility predicate. The scheduler defers updates for elements
   * that return `false` here, replaying them when the host signals
   * visibility via `notifyVisible()`.
   */
  readonly isVisible: (element: Element) => boolean;
  /**
   * `true` to skip the visibility optimization (apply every update
   * immediately regardless of viewport). Useful for tests and for
   * pages with few bindings. Default: `false`.
   */
  readonly disableVisibilityGate?: boolean;
  /** Threshold (in cached elements) above which the gate activates. Default: 50. */
  readonly visibilityGateThreshold?: number;
  /** Function returning the current cache size (used by the threshold). */
  readonly getCacheSize: () => number;
  /** Hook fired after every flush. Used by tests + analytics. */
  readonly onFlush?: (stats: FlushStats) => void;
  /**
   * Function used to schedule the actual DOM-write callback. Defaults
   * to `requestAnimationFrame` when available. Tests inject a synchronous
   * stand-in.
   */
  readonly scheduleFrame?: (callback: FrameRequestCallback) => number;
  /** Counterpart to `scheduleFrame` for cancellation. */
  readonly cancelFrame?: (handle: number) => void;
}

export interface FlushStats {
  readonly applied: number;
  readonly deferred: number;
  readonly durationMs: number;
  readonly identity?: MessageRevision;
  readonly data?: PayloadLivePreviewData;
}

const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_VISIBILITY_THRESHOLD = 50;

/**
 * Buffer entry — one per (field, element) pair. The latest write
 * supersedes any pending one.
 */
interface BufferEntry {
  target: CachedElement;
  value: unknown;
  allFields: Record<string, unknown>;
  identity: MessageRevision | undefined;
  data: PayloadLivePreviewData | undefined;
}

const enum SchedulerSlot {
  Apply,
  DebounceMs,
  IsVisible,
  GateThreshold,
  GateDisabled,
  GetCacheSize,
  OnFlush,
  ScheduleFrame,
  CancelFrame,
  Pending,
  Replay,
  ActiveFlushes,
  DebounceTimer,
  DebounceToken,
  FrameHandle,
  FrameToken,
  ActiveIdentity,
  ActiveRevisionCancelled,
}

/**
 * One TS-private state record avoids emitting ES2020 private-field scaffolding.
 * Named tuple slots keep the source readable while compiling to compact numeric
 * access; this internal class and its tuple never cross the package boundary.
 */
type SchedulerState = [
  apply: ApplyUpdate,
  debounceMs: number,
  isVisible: (element: Element) => boolean,
  gateThreshold: number,
  gateDisabled: boolean,
  getCacheSize: () => number,
  onFlush: ((stats: FlushStats) => void) | undefined,
  scheduleFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  pending: Map<Element, BufferEntry>,
  replay: Map<Element, BufferEntry>,
  activeFlushes: Set<Map<Element, BufferEntry>>,
  debounceTimer: ReturnType<typeof setTimeout> | null,
  debounceToken: number,
  frameHandle: number | null,
  frameToken: number,
  activeIdentity: MessageRevision | null,
  activeRevisionCancelled: boolean,
];

export class UpdateScheduler {
  private readonly s: SchedulerState;

  constructor(apply: ApplyUpdate, options: UpdateSchedulerOptions) {
    const scheduleFrame =
      options.scheduleFrame ??
      (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame.bind(globalThis)
        : (cb) => {
            return setTimeout(() => {
              cb(performance.now());
            }, 0) as unknown as number;
          });
    const cancelFrame =
      options.cancelFrame ??
      (typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame.bind(globalThis)
        : (handle) => {
            clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
          });
    this.s = [
      apply,
      options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      options.isVisible,
      options.visibilityGateThreshold ?? DEFAULT_VISIBILITY_THRESHOLD,
      options.disableVisibilityGate ?? false,
      options.getCacheSize,
      options.onFlush,
      scheduleFrame,
      cancelFrame,
      new Map(),
      new Map(),
      new Set(),
      null,
      0,
      null,
      0,
      null,
      false,
    ];
  }

  /**
   * Queue an update. The same `(element)` pair is coalesced — only the
   * most-recent value survives until the next flush.
   */
  schedule(update: ScheduledUpdate): void {
    if (update.identity !== undefined) {
      if (this.s[SchedulerSlot.ActiveRevisionCancelled]) return;
      if (!sameIdentity(update.identity, this.s[SchedulerSlot.ActiveIdentity])) return;
    }
    const pending = this.s[SchedulerSlot.Pending];
    const existing = pending.get(update.target.element);
    if (existing) {
      existing.value = update.value;
      existing.allFields = update.allFields;
      existing.identity = update.identity;
      existing.data = update.data;
    } else {
      pending.set(update.target.element, {
        ...update,
        // BufferEntry makes these keys explicit so coalescing can overwrite
        // them deterministically even when an older entry had a value.
        identity: update.identity,
        data: update.data,
      });
    }
    this.#armDebounce();
  }

  /**
   * Make `identity` the sole revision allowed to schedule, flush, or replay.
   * Advancing is intentionally destructive even when the new revision is later
   * cancelled: accepting newer work must never revive an older DOM state.
   */
  acceptRevision(identity: MessageRevision): void {
    const activeIdentity = this.s[SchedulerSlot.ActiveIdentity];
    if (sameIdentity(identity, activeIdentity)) return;
    if (activeIdentity !== null && compareIdentity(identity, activeIdentity) < 0) {
      return;
    }
    this.#cancelScheduledWork();
    this.#clearWork();
    this.s[SchedulerSlot.ActiveIdentity] = identity;
    this.s[SchedulerSlot.ActiveRevisionCancelled] = false;
  }

  /** Cancel buffered work for exactly one revision without reviving its predecessor. */
  cancelRevision(identity: MessageRevision): void {
    if (!sameIdentity(identity, this.s[SchedulerSlot.ActiveIdentity])) return;
    this.#cancelScheduledWork();
    this.#clearWork();
    this.s[SchedulerSlot.ActiveRevisionCancelled] = true;
  }

  /**
   * Flush every pending write immediately, bypassing the debounce.
   * Useful for tests and explicit host-controlled flushing. `destroy()`
   * deliberately discards buffered work instead of draining it.
   */
  flushNow(): FlushStats {
    this.#cancelScheduledWork();
    return this.#flush();
  }

  /**
   * Signal that an element has become visible. Any buffered value for
   * that element is applied immediately.
   */
  notifyVisible(element: Element): void {
    const replay = this.s[SchedulerSlot.Replay];
    const entry = replay.get(element);
    if (!entry) return;
    replay.delete(element);
    if (!this.#isCurrent(entry)) return;
    const t0 = performance.now();
    const applied = this.#didApply(entry) ? 1 : 0;
    this.s[SchedulerSlot.OnFlush]?.(this.#statsFor(entry, applied, 0, performance.now() - t0));
  }

  /**
   * Reconcile buffered work with a freshly rebuilt cache entry.
   *
   * A full cache scan deliberately creates new `CachedElement` snapshots. Work
   * for the same element + field binding survives, but must point at that fresh
   * snapshot so changed renderer/attribute/locale metadata is respected. A
   * field-name change is a different binding and therefore discards the stale
   * work rather than applying it under a new identity.
   */
  retarget(target: CachedElement): void {
    this.#retargetBuffer(this.s[SchedulerSlot.Pending], target);
    this.#retargetBuffer(this.s[SchedulerSlot.Replay], target);
    for (const flush of this.s[SchedulerSlot.ActiveFlushes]) {
      this.#retargetBuffer(flush, target);
    }
  }

  /**
   * Discard any replay state for an element. Called when the element
   * leaves the cache.
   */
  forget(element: Element): void {
    this.s[SchedulerSlot.Pending].delete(element);
    this.s[SchedulerSlot.Replay].delete(element);
    for (const flush of this.s[SchedulerSlot.ActiveFlushes]) flush.delete(element);
  }

  /** Cancel timers and drop buffered state. */
  destroy(): void {
    this.#cancelScheduledWork();
    this.#clearWork();
    this.s[SchedulerSlot.ActiveIdentity] = null;
    this.s[SchedulerSlot.ActiveRevisionCancelled] = false;
  }

  /** Test introspection: number of pending writes. */
  get pendingCount(): number {
    return this.s[SchedulerSlot.Pending].size;
  }

  /** Test introspection: number of buffered offscreen replays. */
  get replayCount(): number {
    return this.s[SchedulerSlot.Replay].size;
  }

  #armDebounce(): void {
    const token = (this.s[SchedulerSlot.DebounceToken] += 1);
    const timer = this.s[SchedulerSlot.DebounceTimer];
    this.s[SchedulerSlot.DebounceTimer] = null;
    if (timer !== null) clearTimeout(timer);
    // Clearing a host timer is an external boundary. A re-entrant schedule
    // owns a newer token and must not be replaced by this older stack.
    if (this.s[SchedulerSlot.DebounceToken] !== token) return;
    const nextTimer = setTimeout(() => {
      if (this.s[SchedulerSlot.DebounceToken] !== token) return;
      this.s[SchedulerSlot.DebounceTimer] = null;
      this.#requestFrame();
    }, this.s[SchedulerSlot.DebounceMs]);
    if (this.s[SchedulerSlot.DebounceToken] === token) {
      this.s[SchedulerSlot.DebounceTimer] = nextTimer;
    }
  }

  #requestFrame(): void {
    const token = (this.s[SchedulerSlot.FrameToken] += 1);
    const handle = this.s[SchedulerSlot.FrameHandle];
    this.s[SchedulerSlot.FrameHandle] = null;
    if (handle !== null) this.s[SchedulerSlot.CancelFrame](handle);
    if (this.s[SchedulerSlot.FrameToken] !== token) return;
    // Test/SSR schedulers may invoke the callback before returning a handle.
    // Never publish that already-completed handle as cancellable work.
    let completed = false;
    const nextHandle = this.s[SchedulerSlot.ScheduleFrame](() => {
      if (this.s[SchedulerSlot.FrameToken] !== token) return;
      completed = true;
      this.s[SchedulerSlot.FrameHandle] = null;
      this.#flush();
    });
    // The injected scheduler can execute the callback synchronously, which
    // TypeScript's local control-flow analysis cannot observe.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!completed && this.s[SchedulerSlot.FrameToken] === token) {
      this.s[SchedulerSlot.FrameHandle] = nextHandle;
    }
  }

  #flush(): FlushStats {
    const t0 = performance.now();
    const gateActive =
      !this.s[SchedulerSlot.GateDisabled] &&
      this.s[SchedulerSlot.GetCacheSize]() > this.s[SchedulerSlot.GateThreshold];
    const pending = this.s[SchedulerSlot.Pending];
    this.s[SchedulerSlot.Pending] = new Map();

    let applied = 0;
    let deferred = 0;
    let batchEntry: BufferEntry | undefined;
    this.s[SchedulerSlot.ActiveFlushes].add(pending);
    try {
      for (const entry of pending.values()) {
        if (!this.#isCurrent(entry)) continue;
        const visible = !gateActive || this.s[SchedulerSlot.IsVisible](entry.target.element);
        // Visibility is an injected consumer callback and may accept/cancel a
        // revision synchronously. Re-check before publishing replay or writes.
        if (!this.#isCurrent(entry)) continue;
        batchEntry ??= entry;
        if (!visible) {
          this.s[SchedulerSlot.Replay].set(entry.target.element, entry);
          deferred += 1;
          continue;
        }
        // A visible write for this element supersedes any older replay entry,
        // including legacy/unversioned callers of the scheduler.
        this.s[SchedulerSlot.Replay].delete(entry.target.element);
        if (this.#didApply(entry)) applied += 1;
      }
    } finally {
      this.s[SchedulerSlot.ActiveFlushes].delete(pending);
    }
    const stats = this.#statsFor(batchEntry, applied, deferred, performance.now() - t0);
    this.s[SchedulerSlot.OnFlush]?.(stats);
    return stats;
  }

  #isCurrent(entry: BufferEntry): boolean {
    return (
      entry.identity === undefined ||
      (!this.s[SchedulerSlot.ActiveRevisionCancelled] &&
        sameIdentity(entry.identity, this.s[SchedulerSlot.ActiveIdentity]))
    );
  }

  #didApply(entry: BufferEntry): boolean {
    // The public callback remains `void`; only a package-owned callback marked
    // by the runtime may reserve exact false as a rejected/no-write result.
    const apply = this.s[SchedulerSlot.Apply];
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const outcome: unknown = apply(entry);
    return outcome !== false || !usesNoWriteOutcome(apply);
  }

  #retargetBuffer(buffer: Map<Element, BufferEntry>, target: CachedElement): void {
    const entry = buffer.get(target.element);
    if (entry === undefined) return;
    if (entry.target.fieldName !== target.fieldName || entry.target.locale !== target.locale) {
      // Locale selects the value before scheduling and can also affect plugin
      // transforms. Retargeting only the metadata would pair a value prepared
      // for the old locale with the new locale. Discard that work; a later
      // revision can prepare the new binding coherently.
      buffer.delete(target.element);
      return;
    }
    entry.target = target;
  }

  #clearWork(): void {
    this.s[SchedulerSlot.Pending].clear();
    this.s[SchedulerSlot.Replay].clear();
    for (const flush of this.s[SchedulerSlot.ActiveFlushes]) flush.clear();
  }

  #statsFor(
    entry: BufferEntry | undefined,
    applied: number,
    deferred: number,
    durationMs: number,
  ): FlushStats {
    return {
      applied,
      deferred,
      durationMs,
      ...(entry?.identity !== undefined ? { identity: entry.identity } : {}),
      ...(entry?.data !== undefined ? { data: entry.data } : {}),
    };
  }

  #cancelScheduledWork(): void {
    const debounceTimer = this.s[SchedulerSlot.DebounceTimer];
    const frameHandle = this.s[SchedulerSlot.FrameHandle];
    // Revoke both ownership tokens and handles before calling cancellation
    // hooks. Ineffectively-cancelled callbacks remain inert; re-entrant newer
    // work published by a hook is not clobbered by this older cleanup stack.
    this.s[SchedulerSlot.DebounceToken] += 1;
    this.s[SchedulerSlot.FrameToken] += 1;
    this.s[SchedulerSlot.DebounceTimer] = null;
    this.s[SchedulerSlot.FrameHandle] = null;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (frameHandle !== null) this.s[SchedulerSlot.CancelFrame](frameHandle);
  }
}

function sameIdentity(a: MessageRevision, b: MessageRevision | null): boolean {
  return b !== null && a.generation === b.generation && a.revision === b.revision;
}

function compareIdentity(a: MessageRevision, b: MessageRevision): number {
  if (a.generation !== b.generation) return a.generation - b.generation;
  return a.revision - b.revision;
}
