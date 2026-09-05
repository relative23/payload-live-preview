/**
 * Debounce, frame batching and off-screen replay for scheduled writes. The
 * scheduler never touches the DOM; the injected `apply` callback does.
 */

import type { PayloadLivePreviewData } from '@/types/payload-protocol';
import { usesNoWriteOutcome } from './internal-outcome';
import { type MessageRevision, sameRevision } from './message-bus';
import type { CachedElement } from './types';

export interface ScheduledUpdate {
  readonly target: CachedElement;
  readonly value: unknown;
  readonly allFields: Record<string, unknown>;
  /** Revision revision; runtime-produced entries always carry one. */
  readonly revision?: MessageRevision | undefined;
  readonly data?: PayloadLivePreviewData | undefined;
  /** `valueIdentity(value)`, computed once by the pipeline for skip and reveal. */
  readonly valueIdentity?: string | undefined;
}

export type ApplyUpdate = (update: ScheduledUpdate) => void;

export interface UpdateSchedulerOptions {
  /** Debounce window in ms. Default 50. */
  readonly debounceMs?: number;
  /** Longest a flush may be postponed by continuous scheduling. Default `4 * debounceMs`. */
  readonly maxWaitMs?: number;
  /** Deferred writes replay when the host reports the element visible via `notifyVisible()`. */
  readonly isVisible: (element: Element) => boolean;
  /** Apply every write immediately regardless of visibility. Default `false`. */
  readonly disableVisibilityGate?: boolean;
  /** Cached-element count above which the gate activates. Default 50. */
  readonly visibilityGateThreshold?: number;
  readonly getCacheSize: () => number;
  readonly onFlush?: (stats: FlushStats) => void;
  /** Frame scheduler; defaults to `requestAnimationFrame`. Tests inject a synchronous one. */
  readonly scheduleFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export interface FlushStats {
  readonly applied: number;
  /** Field names applied, in order; `applied` alone cannot say which binding stayed stale. */
  readonly appliedFields: readonly string[];
  readonly deferred: number;
  readonly durationMs: number;
  readonly revision?: MessageRevision;
  readonly data?: PayloadLivePreviewData;
}

const DEFAULT_DEBOUNCE_MS = 50;
/** Exported so `pll doctor` can prove its own copy of the number has not drifted. */
export const DEFAULT_VISIBILITY_THRESHOLD = 50;

interface BufferEntry {
  target: CachedElement;
  value: unknown;
  allFields: Record<string, unknown>;
  revision: MessageRevision | undefined;
  data: PayloadLivePreviewData | undefined;
  valueIdentity: string | undefined;
}

export class UpdateScheduler {
  private readonly apply: ApplyUpdate;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly isVisible: (element: Element) => boolean;
  private readonly gateThresholdValue: number;
  private readonly gateDisabled: boolean;
  private readonly getCacheSize: () => number;
  private readonly onFlush: ((stats: FlushStats) => void) | undefined;
  private readonly scheduleFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private pending = new Map<Element, BufferEntry>();
  private readonly replay = new Map<Element, BufferEntry>();
  private readonly activeFlushes = new Set<Map<Element, BufferEntry>>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceToken = 0;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private frameHandle: number | null = null;
  private frameToken = 0;
  private activeRevision: MessageRevision | null = null;
  private activeRevisionCancelled = false;

  constructor(apply: ApplyUpdate, options: UpdateSchedulerOptions) {
    this.apply = apply;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? this.debounceMs * 4;
    this.isVisible = options.isVisible;
    this.gateThresholdValue = options.visibilityGateThreshold ?? DEFAULT_VISIBILITY_THRESHOLD;
    this.gateDisabled = options.disableVisibilityGate ?? false;
    this.getCacheSize = options.getCacheSize;
    this.onFlush = options.onFlush;
    this.scheduleFrame =
      options.scheduleFrame ??
      (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame.bind(globalThis)
        : (callback) =>
            setTimeout(() => {
              callback(performance.now());
            }, 0) as unknown as number);
    this.cancelFrame =
      options.cancelFrame ??
      (typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame.bind(globalThis)
        : (handle) => {
            clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
          });
  }

  /** Queue a write; a later write for the same element replaces it until the flush. */
  schedule(update: ScheduledUpdate): void {
    if (update.revision !== undefined) {
      if (this.activeRevisionCancelled) return;
      if (this.activeRevision === null || !sameRevision(update.revision, this.activeRevision)) {
        return;
      }
    }
    const existing = this.pending.get(update.target.element);
    if (existing) {
      existing.value = update.value;
      existing.allFields = update.allFields;
      existing.revision = update.revision;
      existing.data = update.data;
      existing.valueIdentity = update.valueIdentity;
    } else {
      this.pending.set(update.target.element, {
        target: update.target,
        value: update.value,
        allFields: update.allFields,
        revision: update.revision,
        data: update.data,
        valueIdentity: update.valueIdentity,
      });
    }
    this.armDebounce();
  }

  /**
   * Make `revision` the sole revision allowed to schedule, flush or replay.
   * Older buffered work is dropped even if the new revision is later cancelled.
   */
  acceptRevision(revision: MessageRevision): void {
    if (this.activeRevision !== null && sameRevision(revision, this.activeRevision)) return;
    if (this.activeRevision !== null && compareRevision(revision, this.activeRevision) < 0) return;
    this.cancelScheduledWork();
    this.clearWork();
    this.activeRevision = revision;
    this.activeRevisionCancelled = false;
  }

  /** Cancel buffered work for exactly one revision without reviving its predecessor. */
  cancelRevision(revision: MessageRevision): void {
    if (this.activeRevision === null || !sameRevision(revision, this.activeRevision)) return;
    this.cancelScheduledWork();
    this.clearWork();
    this.activeRevisionCancelled = true;
  }

  /** Flush immediately, bypassing the debounce. */
  flushNow(): FlushStats {
    this.cancelScheduledWork();
    return this.flush();
  }

  /** Apply the buffered value for an element that scrolled into view. */
  notifyVisible(element: Element): void {
    const entry = this.replay.get(element);
    if (!entry) return;
    this.replay.delete(element);
    if (!this.isCurrent(entry)) return;
    const t0 = performance.now();
    const applied = this.didApply(entry) ? 1 : 0;
    this.onFlush?.(
      this.statsFor(
        entry,
        applied,
        0,
        performance.now() - t0,
        applied === 1 ? [entry.target.fieldName] : [],
      ),
    );
  }

  /**
   * Point buffered work at a rebuilt cache entry for the same element and
   * field. A different field or locale is a different binding: drop the work.
   */
  retarget(target: CachedElement): void {
    this.retargetBuffer(this.pending, target);
    this.retargetBuffer(this.replay, target);
    for (const flush of this.activeFlushes) this.retargetBuffer(flush, target);
  }

  forget(element: Element): void {
    this.pending.delete(element);
    this.replay.delete(element);
    for (const flush of this.activeFlushes) flush.delete(element);
  }

  /** Cancel timers and drop buffered state without draining it. */
  destroy(): void {
    this.cancelScheduledWork();
    this.clearWork();
    this.activeRevision = null;
    this.activeRevisionCancelled = false;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get replayCount(): number {
    return this.replay.size;
  }

  get gateThreshold(): number {
    return this.gateThresholdValue;
  }

  get gateActive(): boolean {
    return !this.gateDisabled && this.getCacheSize() > this.gateThresholdValue;
  }

  private armDebounce(): void {
    const token = (this.debounceToken += 1);
    const timer = this.debounceTimer;
    this.debounceTimer = null;
    if (timer !== null) clearTimeout(timer);
    // clearTimeout is a host boundary; a reentrant schedule owns a newer token.
    if (this.debounceToken !== token) return;
    const next = setTimeout(() => {
      if (this.debounceToken !== token) return;
      this.debounceTimer = null;
      this.requestFrame();
    }, this.debounceMs);
    if (this.debounceToken === token) this.debounceTimer = next;
    // Continuous scheduling (key repeat) must not postpone the flush forever.
    if (this.deadlineTimer === null && this.maxWaitMs > this.debounceMs) {
      this.deadlineTimer = setTimeout(() => {
        this.deadlineTimer = null;
        if (this.pending.size > 0) this.requestFrame();
      }, this.maxWaitMs);
    }
  }

  private requestFrame(): void {
    const token = (this.frameToken += 1);
    const handle = this.frameHandle;
    this.frameHandle = null;
    if (handle !== null) this.cancelFrame(handle);
    if (this.frameToken !== token) return;
    let completed = false;
    const next = this.scheduleFrame(() => {
      if (this.frameToken !== token) return;
      completed = true;
      this.frameHandle = null;
      this.flush();
    });
    // An injected scheduler may run the callback synchronously; never publish a spent handle.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!completed && this.frameToken === token) this.frameHandle = next;
  }

  private flush(): FlushStats {
    const t0 = performance.now();
    this.clearDeadline();
    const gateActive = this.gateActive;
    const pending = this.pending;
    this.pending = new Map();
    let applied = 0;
    const appliedFields: string[] = [];
    let deferred = 0;
    let batchEntry: BufferEntry | undefined;
    this.activeFlushes.add(pending);
    try {
      for (const entry of pending.values()) {
        if (!this.isCurrent(entry)) continue;
        const visible = !gateActive || this.isVisible(entry.target.element);
        // The visibility callback is consumer code and may change the revision.
        if (!this.isCurrent(entry)) continue;
        batchEntry ??= entry;
        if (!visible) {
          this.replay.set(entry.target.element, entry);
          deferred += 1;
          continue;
        }
        this.replay.delete(entry.target.element);
        if (this.didApply(entry)) {
          applied += 1;
          appliedFields.push(entry.target.fieldName);
        }
      }
    } finally {
      this.activeFlushes.delete(pending);
    }
    const stats = this.statsFor(
      batchEntry,
      applied,
      deferred,
      performance.now() - t0,
      appliedFields,
    );
    this.onFlush?.(stats);
    return stats;
  }

  private isCurrent(entry: BufferEntry): boolean {
    return (
      entry.revision === undefined ||
      (!this.activeRevisionCancelled &&
        this.activeRevision !== null &&
        sameRevision(entry.revision, this.activeRevision))
    );
  }

  private didApply(entry: BufferEntry): boolean {
    // Only a runtime-marked callback may report exact `false` as "no write".
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const outcome: unknown = this.apply(entry);
    return outcome !== false || !usesNoWriteOutcome(this.apply);
  }

  private retargetBuffer(buffer: Map<Element, BufferEntry>, target: CachedElement): void {
    const entry = buffer.get(target.element);
    if (entry === undefined) return;
    if (entry.target.fieldName !== target.fieldName || entry.target.locale !== target.locale) {
      buffer.delete(target.element);
      return;
    }
    entry.target = target;
  }

  private clearWork(): void {
    this.pending.clear();
    this.replay.clear();
    for (const flush of this.activeFlushes) flush.clear();
  }

  private statsFor(
    entry: BufferEntry | undefined,
    applied: number,
    deferred: number,
    durationMs: number,
    appliedFields: readonly string[],
  ): FlushStats {
    return {
      applied,
      appliedFields,
      deferred,
      durationMs,
      ...(entry?.revision !== undefined ? { revision: entry.revision } : {}),
      ...(entry?.data !== undefined ? { data: entry.data } : {}),
    };
  }

  private clearDeadline(): void {
    if (this.deadlineTimer === null) return;
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
  }

  private cancelScheduledWork(): void {
    const debounceTimer = this.debounceTimer;
    const frameHandle = this.frameHandle;
    // Revoke tokens before calling host cancellation, so a hook that
    // schedules newer work is not clobbered by this older cleanup.
    this.debounceToken += 1;
    this.frameToken += 1;
    this.debounceTimer = null;
    this.frameHandle = null;
    this.clearDeadline();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (frameHandle !== null) this.cancelFrame(frameHandle);
  }
}

function compareRevision(a: MessageRevision, b: MessageRevision): number {
  if (a.generation !== b.generation) return a.generation - b.generation;
  return a.revision - b.revision;
}
