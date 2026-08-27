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

import type { PayloadDocumentEventDetail, PayloadLivePreviewData } from '@/types/payload-protocol';
import type { DiagnosticCode } from '@core/diagnostic-codes';

export interface LivePreviewEventMap {
  /**
   * Fired once per startup attempt after observers, cache, and message listening
   * are active. A later startup failure may roll that attempt back; retrying then
   * emits a new `init` event.
   */
  readonly init: { readonly timestamp: number };

  /** Fired for the first accepted data-bearing update from a trusted origin. */
  readonly connect: { readonly origin: string; readonly timestamp: number };

  /**
   * Fired when the heartbeat times out or the runtime is destroyed. The
   * `'unload'` reason remains in the public union for 1.x producer compatibility;
   * the built-in runtime does not currently emit it.
   */
  readonly disconnect: {
    readonly reason: 'timeout' | 'destroy' | 'unload';
    readonly timestamp: number;
  };

  /**
   * Fired before the DOM is mutated for an incoming update.
   *
   * Handlers may call `cancel()` before their synchronous or asynchronous
   * work settles to skip exactly this revision.
   */
  readonly beforeUpdate: {
    readonly data: PayloadLivePreviewData;
    /** Runtime-populated ordering metadata; optional for 1.x producer compatibility. */
    readonly revision?: number;
    /** When the runtime accepted the message, Unix milliseconds. Optional for 1.x producer compatibility. */
    readonly receivedAt?: number;
    /**
     * What produced the update. `'patch'` — a postMessage from the admin — is
     * the only source until fragment strategies arrive; then it names the
     * strategy. Optional for 1.x producer compatibility.
     */
    readonly source?: 'patch';
    readonly cancel: () => void;
  };

  /**
   * Fired after each actual, current DOM application batch. Visibility replay
   * may produce another event for the same revision; cancelled, obsolete, and
   * deferred-only batches produce none.
   */
  readonly afterUpdate: {
    readonly data: PayloadLivePreviewData;
    readonly updatedCount: number;
    readonly durationMs: number;
    /** Runtime-populated ordering metadata; optional for 1.x producer compatibility. */
    readonly revision?: number;
    /** When the runtime accepted the message, Unix milliseconds. Optional for 1.x producer compatibility. */
    readonly receivedAt?: number;
    /**
     * What produced the update. `'patch'` — a postMessage from the admin — is
     * the only source until fragment strategies arrive; then it names the
     * strategy. Optional for 1.x producer compatibility.
     */
    readonly source?: 'patch';
  };

  /** Fired for each successful, still-current element write. */
  readonly elementUpdate: {
    readonly element: Element;
    readonly fieldName: string;
    readonly previousValue: unknown;
    readonly nextValue: unknown;
    /** Runtime-populated ordering metadata; optional for 1.x producer compatibility. */
    readonly revision?: number;
    /** When the runtime accepted the message, Unix milliseconds. Optional for 1.x producer compatibility. */
    readonly receivedAt?: number;
    /**
     * What produced the update. `'patch'` — a postMessage from the admin — is
     * the only source until fragment strategies arrive; then it names the
     * strategy. Optional for 1.x producer compatibility.
     */
    readonly source?: 'patch';
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
   * Fired when a data update carries `externallyUpdatedRelationship` — a
   * related document was created or edited in an admin drawer. The update
   * itself re-renders unconditionally, because populated values may have
   * changed while the form values did not.
   */
  readonly relationshipUpdate: {
    readonly detail: PayloadDocumentEventDetail;
    readonly timestamp: number;
  };

  /**
   * Fired on errors that the runtime caught but cannot fully recover from.
   *
   * The `context` string identifies where the error originated. `code` says
   * the same thing in a form that survives rewording — branch on `code`, read
   * `context` when you want the human-readable origin.
   */
  readonly error: {
    readonly error: Error;
    readonly context: string;
    readonly code: DiagnosticCode;
  };

  /**
   * Fired during destroy after browser observers and the message listener are
   * removed. Event/plugin listeners remain available for this notification and
   * are released by the owning client afterwards.
   */
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
