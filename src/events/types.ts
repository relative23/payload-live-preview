/**
 * Public event payload shapes for the live preview lifecycle.
 *
 * The map keys form the union of valid event names. Adding a new event
 * is a two-line change: add the entry here and dispatch from the
 * relevant module. Consumers get autocompletion and exhaustive checks
 * for free because the `EventEmitter` is generic over this map.
 *
 * @module @events/types
 */

import type { PayloadLivePreviewData } from '@/types/payload-protocol';

export interface LivePreviewEventMap {
  /** Fired once when a client instance finishes its synchronous init. */
  readonly init: { readonly timestamp: number };

  /** Fired the first time a valid update message is received from a trusted origin. */
  readonly connect: { readonly origin: string; readonly timestamp: number };

  /** Fired when the heartbeat times out or the iframe is unloaded. */
  readonly disconnect: {
    readonly reason: 'timeout' | 'destroy' | 'unload';
    readonly timestamp: number;
  };

  /**
   * Fired before the DOM is mutated for an incoming update.
   *
   * Handlers may call `cancel()` synchronously to skip the update —
   * useful for read-only previews or A/B testing.
   */
  readonly beforeUpdate: {
    readonly data: PayloadLivePreviewData;
    readonly cancel: () => void;
  };

  /** Fired after all DOM mutations for an incoming update have completed. */
  readonly afterUpdate: {
    readonly data: PayloadLivePreviewData;
    readonly updatedCount: number;
    readonly durationMs: number;
  };

  /** Fired for each individual element write performed during an update. */
  readonly elementUpdate: {
    readonly element: Element;
    readonly fieldName: string;
    readonly previousValue: unknown;
    readonly nextValue: unknown;
  };

  /** Fired whenever the element cache is rebuilt (initial scan or MutationObserver-triggered). */
  readonly cacheRefresh: {
    readonly elementCount: number;
    readonly fieldCount: number;
    readonly durationMs: number;
  };

  /** Fired when a `payload-document-event` message arrives (document save). */
  readonly documentSave: { readonly timestamp: number };

  /**
   * Fired on errors that the runtime caught but cannot fully recover from.
   *
   * The `context` string identifies where the error originated.
   */
  readonly error: {
    readonly error: Error;
    readonly context: string;
  };

  /** Fired during destroy after observers and listeners are removed. */
  readonly destroy: { readonly timestamp: number };
}

/**
 * Handler signature: receives the payload and may return a Promise.
 *
 * Promise-returning handlers are awaited in registration order — this
 * is important for `beforeUpdate.cancel()` semantics.
 */
export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

/** Subscription removal function returned by `on()`/`once()`. */
export type Unsubscribe = () => void;
