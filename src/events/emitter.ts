/**
 * Per-instance, type-safe event emitter.
 *
 * Replaces the legacy module-level singleton. Each `LivePreviewClient`
 * instantiates its own emitter so that calling `destroy()` on one
 * instance cannot clobber listeners attached to another.
 *
 * Design notes:
 *
 *   - Generic over an event map type. The default `LivePreviewEventMap`
 *     captures every event this library emits, but the implementation
 *     is reusable for any map.
 *   - Handlers may be `async`. They are awaited sequentially in
 *     registration order. This is intentional: `beforeUpdate.cancel()`
 *     and similar synchronization rely on stable ordering.
 *   - Errors thrown by one handler are logged via `console.error` and
 *     do not prevent later handlers from running.
 *   - `once()` semantics: registered into a separate map; the entire
 *     set for an event is cleared after dispatch, even if individual
 *     handlers throw.
 *
 * @module @events/emitter
 */

import type { EventHandler, LivePreviewEventMap, Unsubscribe } from './types';

type AnyHandler = EventHandler<unknown>;

// The constraint `object` (not `Record<string, unknown>`) accommodates
// interfaces with readonly properties and exact-optional fields without
// forcing consumers to weaken their type definitions.
export class EventEmitter<TMap extends object = LivePreviewEventMap> {
  readonly #regular = new Map<keyof TMap, Set<AnyHandler>>();
  readonly #once = new Map<keyof TMap, Set<AnyHandler>>();

  /**
   * Subscribe `handler` to `event`. Returns an unsubscribe function;
   * call it to remove the handler. The handler is invoked for every
   * subsequent emit until unsubscribed.
   */
  on<E extends keyof TMap>(event: E, handler: EventHandler<TMap[E]>): Unsubscribe {
    return this.#register(this.#regular, event, handler as AnyHandler);
  }

  /**
   * Subscribe `handler` for a single emit. After the first dispatch,
   * the handler is removed automatically.
   */
  once<E extends keyof TMap>(event: E, handler: EventHandler<TMap[E]>): Unsubscribe {
    return this.#register(this.#once, event, handler as AnyHandler);
  }

  /**
   * Remove `handler` from `event`. Works for both `on`- and
   * `once`-registered handlers. No-op when the handler isn't registered.
   */
  off<E extends keyof TMap>(event: E, handler: EventHandler<TMap[E]>): void {
    this.#regular.get(event)?.delete(handler as AnyHandler);
    this.#once.get(event)?.delete(handler as AnyHandler);
  }

  /**
   * Dispatch `payload` to every handler registered for `event`.
   *
   * Handlers run sequentially in registration order — regular ones
   * first, then `once` handlers. Async handlers are awaited. Synchronous
   * exceptions are caught, logged, and isolated to the offending handler.
   */
  async emit<E extends keyof TMap>(event: E, payload: TMap[E]): Promise<void> {
    const regular = this.#regular.get(event);
    if (regular) {
      for (const handler of [...regular]) await this.#invoke(handler, payload, event);
    }
    const once = this.#once.get(event);
    if (once && once.size > 0) {
      const snapshot = [...once];
      this.#once.delete(event);
      for (const handler of snapshot) await this.#invoke(handler, payload, event);
    }
  }

  /**
   * Number of handlers currently registered for `event`.
   * Sum of `on` and `once` registrations.
   */
  listenerCount(event: keyof TMap): number {
    return (this.#regular.get(event)?.size ?? 0) + (this.#once.get(event)?.size ?? 0);
  }

  /**
   * Remove every handler. Pass an event name to limit the removal to
   * one event; omit it to clear every event on this emitter.
   *
   * Crucially this only affects the current instance — there is no
   * shared global state.
   */
  removeAllListeners(event?: keyof TMap): void {
    if (event === undefined) {
      this.#regular.clear();
      this.#once.clear();
      return;
    }
    this.#regular.delete(event);
    this.#once.delete(event);
  }

  /**
   * Snapshot of all event names that currently have at least one
   * registered handler. Useful for debugging.
   */
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
      bucket.get(event)?.delete(handler);
    };
  }

  async #invoke(handler: AnyHandler, payload: unknown, event: keyof TMap): Promise<void> {
    try {
      await handler(payload);
    } catch (err) {
      const label =
        typeof event === 'string' || typeof event === 'number' ? String(event) : '<event>';
      console.error(`[live-preview] handler for "${label}" threw:`, err);
    }
  }
}
