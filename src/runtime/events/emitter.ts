/**
 * Per-instance typed emitter: handlers run sequentially in registration order,
 * may be async, and a throwing one is logged and isolated. See ADR 0002.
 */

import type { EventHandler, LivePreviewEventMap, Unsubscribe } from './types';
import { safeConsoleError } from '@core/diagnostics';

type AnyHandler = EventHandler<unknown>;

// `object`, not `Record<string, unknown>`: interfaces with readonly and
// exact-optional properties must be usable as maps.
export class EventEmitter<TMap extends object = LivePreviewEventMap> {
  readonly #regular = new Map<keyof TMap, Set<AnyHandler>>();
  readonly #once = new Map<keyof TMap, Set<AnyHandler>>();

  on<E extends keyof TMap>(event: E, handler: EventHandler<TMap[E]>): Unsubscribe {
    return this.#register(this.#regular, event, handler as AnyHandler);
  }

  once<E extends keyof TMap>(event: E, handler: EventHandler<TMap[E]>): Unsubscribe {
    return this.#register(this.#once, event, handler as AnyHandler);
  }

  off<E extends keyof TMap>(event: E, handler: EventHandler<TMap[E]>): void {
    this.#remove(this.#regular, event, handler as AnyHandler);
    this.#remove(this.#once, event, handler as AnyHandler);
  }

  /** Dispatch to every handler: regular ones first, then `once` handlers. */
  async emit<E extends keyof TMap>(event: E, payload: TMap[E]): Promise<void> {
    await this.#emitSequential(event, payload);
  }

  /**
   * Dispatch while `shouldContinue()` holds — checked around every handler, so
   * an obsolete transaction cannot resume across an await.
   * @internal
   */
  async emitWhile<E extends keyof TMap>(
    event: E,
    payload: TMap[E],
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    return this.#emitSequential(event, payload, shouldContinue);
  }

  async #emitSequential<E extends keyof TMap>(
    event: E,
    payload: TMap[E],
    shouldContinue?: () => boolean,
  ): Promise<boolean> {
    const eligible = (): boolean => shouldContinue?.() ?? true;
    if (!eligible()) return false;
    const regular = this.#regular.get(event);
    if (regular) {
      for (const handler of [...regular]) {
        if (!eligible()) return false;
        await this.#invoke(handler, payload, event);
        if (!eligible()) return false;
      }
    }
    if (!eligible()) return false;
    const once = this.#once.get(event);
    if (once && once.size > 0) {
      const snapshot = [...once];
      this.#once.delete(event);
      for (const handler of snapshot) {
        if (!eligible()) return false;
        await this.#invoke(handler, payload, event);
        if (!eligible()) return false;
      }
    }
    return eligible();
  }

  /** Registered handlers for `event`, `on` and `once` together. */
  listenerCount(event: keyof TMap): number {
    return (this.#regular.get(event)?.size ?? 0) + (this.#once.get(event)?.size ?? 0);
  }

  /** Remove every handler, or only those of `event`. */
  removeAllListeners(event?: keyof TMap): void {
    if (event === undefined) {
      this.#regular.clear();
      this.#once.clear();
      return;
    }
    this.#regular.delete(event);
    this.#once.delete(event);
  }

  /** Event names with at least one handler. */
  eventNames(): (keyof TMap)[] {
    const names = new Set<keyof TMap>();
    for (const key of this.#regular.keys()) names.add(key);
    for (const key of this.#once.keys()) names.add(key);
    return [...names];
  }

  #register(
    bucket: Map<keyof TMap, Set<AnyHandler>>,
    event: keyof TMap,
    handler: AnyHandler,
  ): Unsubscribe {
    let set = bucket.get(event);
    if (!set) {
      set = new Set();
      bucket.set(event, set);
    }
    set.add(handler);
    return () => {
      this.#remove(bucket, event, handler);
    };
  }

  #remove(bucket: Map<keyof TMap, Set<AnyHandler>>, event: keyof TMap, handler: AnyHandler): void {
    const set = bucket.get(event);
    if (set === undefined) return;
    set.delete(handler);
    if (set.size === 0) bucket.delete(event);
  }

  async #invoke(handler: AnyHandler, payload: unknown, event: keyof TMap): Promise<void> {
    try {
      await handler(payload);
    } catch (err) {
      const label =
        typeof event === 'string' || typeof event === 'number' ? String(event) : '<event>';
      safeConsoleError(`[live-preview] LP0601: handler for "${label}" threw:`, err);
    }
  }
}
