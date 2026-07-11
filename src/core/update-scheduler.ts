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

export interface ScheduledUpdate {
  readonly target: CachedElement;
  readonly value: unknown;
  readonly allFields: Record<string, unknown>;
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
}

const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_VISIBILITY_THRESHOLD = 50;

/**
 * Buffer entry — one per (field, element) pair. The latest write
 * supersedes any pending one.
 */
interface BufferEntry {
  readonly target: CachedElement;
  value: unknown;
  allFields: Record<string, unknown>;
}

export class UpdateScheduler {
  readonly #apply: ApplyUpdate;
  readonly #debounceMs: number;
  readonly #isVisible: (element: Element) => boolean;
  readonly #gateThreshold: number;
  readonly #gateDisabled: boolean;
  readonly #getCacheSize: () => number;
  readonly #onFlush: ((stats: FlushStats) => void) | undefined;
  readonly #scheduleFrame: (callback: FrameRequestCallback) => number;
  readonly #cancelFrame: (handle: number) => void;

  /** Per-element latest pending value, applied on next flush. */
  #pending = new Map<Element, BufferEntry>();
  /** Per-element value to apply when element becomes visible. */
  readonly #replay = new Map<Element, BufferEntry>();

  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #frameHandle: number | null = null;

  constructor(apply: ApplyUpdate, options: UpdateSchedulerOptions) {
    this.#apply = apply;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#isVisible = options.isVisible;
    this.#gateThreshold = options.visibilityGateThreshold ?? DEFAULT_VISIBILITY_THRESHOLD;
    this.#gateDisabled = options.disableVisibilityGate ?? false;
    this.#getCacheSize = options.getCacheSize;
    this.#onFlush = options.onFlush;
    this.#scheduleFrame =
      options.scheduleFrame ??
      (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame.bind(globalThis)
        : (cb) => {
            return setTimeout(() => {
              cb(performance.now());
            }, 0) as unknown as number;
          });
    this.#cancelFrame =
      options.cancelFrame ??
      (typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame.bind(globalThis)
        : (handle) => {
            clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
          });
  }

  /**
   * Queue an update. The same `(element)` pair is coalesced — only the
   * most-recent value survives until the next flush.
   */
  schedule(update: ScheduledUpdate): void {
    const existing = this.#pending.get(update.target.element);
    if (existing) {
      existing.value = update.value;
      existing.allFields = update.allFields;
    } else {
      this.#pending.set(update.target.element, {
        target: update.target,
        value: update.value,
        allFields: update.allFields,
      });
    }
    this.#armDebounce();
  }

  /**
   * Flush every pending write immediately, bypassing the debounce.
   * Useful for tests and for `destroy()` to drain in-flight work.
   */
  flushNow(): FlushStats {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    return this.#flush();
  }

  /**
   * Signal that an element has become visible. Any buffered value for
   * that element is applied immediately.
   */
  notifyVisible(element: Element): void {
    const entry = this.#replay.get(element);
    if (!entry) return;
    this.#replay.delete(element);
    this.#apply(entry);
  }

  /**
   * Discard any replay state for an element. Called when the element
   * leaves the cache.
   */
  forget(element: Element): void {
    this.#pending.delete(element);
    this.#replay.delete(element);
  }

  /** Cancel timers and drop buffered state. */
  destroy(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#frameHandle !== null) {
      this.#cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
    this.#pending.clear();
    this.#replay.clear();
  }

  /** Test introspection: number of pending writes. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Test introspection: number of buffered offscreen replays. */
  get replayCount(): number {
    return this.#replay.size;
  }

  #armDebounce(): void {
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#requestFrame();
    }, this.#debounceMs);
  }

  #requestFrame(): void {
    if (this.#frameHandle !== null) this.#cancelFrame(this.#frameHandle);
    this.#frameHandle = this.#scheduleFrame(() => {
      this.#frameHandle = null;
      this.#flush();
    });
  }

  #flush(): FlushStats {
    const t0 = performance.now();
    const gateActive = !this.#gateDisabled && this.#getCacheSize() > this.#gateThreshold;
    const pending = this.#pending;
    this.#pending = new Map();

    let applied = 0;
    let deferred = 0;
    for (const entry of pending.values()) {
      if (gateActive && !this.#isVisible(entry.target.element)) {
        this.#replay.set(entry.target.element, entry);
        deferred += 1;
        continue;
      }
      // If the element later went off-screen between schedule and flush,
      // we still apply: it was visible at schedule time, so the user
      // will see the change as soon as they scroll back.
      this.#apply(entry);
      applied += 1;
    }
    const stats: FlushStats = {
      applied,
      deferred,
      durationMs: performance.now() - t0,
    };
    this.#onFlush?.(stats);
    return stats;
  }
}
