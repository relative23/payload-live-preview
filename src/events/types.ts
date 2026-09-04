/** Public event payloads. The map keys are the valid event names; `EventEmitter` is generic over it. */

import type { PayloadDocumentEventDetail, PayloadLivePreviewData } from '@/types/payload-protocol';
import type { UpdateSource } from '@core/strategies';
import type { DiagnosticCode } from '@core/diagnostic-codes';

export interface LivePreviewEventMap {
  /** Once per startup attempt, after observers, cache and message listening are active. A rolled-back attempt emits it again on retry. */
  readonly init: { readonly timestamp: number };

  /** The first accepted data-bearing update from a trusted origin. */
  readonly connect: { readonly origin: string; readonly timestamp: number };

  /** The heartbeat timed out, the runtime was destroyed, or the page was suspended for navigation (`'unload'`). */
  readonly disconnect: {
    readonly reason: 'timeout' | 'destroy' | 'unload';
    readonly timestamp: number;
  };

  /** Before the DOM is mutated for an update; `cancel()` skips exactly this revision. */
  readonly beforeUpdate: {
    readonly data: PayloadLivePreviewData;
    readonly revision?: number;
    /** When the runtime accepted the message, Unix milliseconds. */
    readonly receivedAt?: number;
    /** The strategy that produced the update. */
    readonly source?: UpdateSource;
    readonly cancel: () => void;
  };

  /** After each applied, still-current batch. Visibility replay may emit another for the same revision; cancelled, obsolete and deferred-only batches emit none. */
  readonly afterUpdate: {
    readonly data: PayloadLivePreviewData;
    readonly updatedCount: number;
    readonly durationMs: number;
    readonly revision?: number;
    readonly receivedAt?: number;
    readonly source?: UpdateSource;
  };

  /** Each successful, still-current element write. */
  readonly elementUpdate: {
    readonly element: Element;
    readonly fieldName: string;
    readonly previousValue: unknown;
    readonly nextValue: unknown;
    readonly revision?: number;
    readonly receivedAt?: number;
    readonly source?: UpdateSource;
  };

  /** The element cache was rebuilt (initial scan or mutation). */
  readonly cacheRefresh: {
    readonly elementCount: number;
    readonly fieldCount: number;
    readonly durationMs: number;
  };

  /** Once per fragment boundary and revision: rendered by the server, or failed (with the LP08xx code) and patched instead. */
  readonly fragmentRender: {
    readonly element: Element;
    readonly id: string;
    readonly key: string | undefined;
    readonly status: 'rendered' | 'failed';
    readonly code?: DiagnosticCode;
    readonly revision: number;
    readonly receivedAt: number;
  };

  /** A `payload-document-event` message arrived (document save). */
  readonly documentSave: { readonly timestamp: number };

  /** A data update carried `externallyUpdatedRelationship`: a related document changed in an admin drawer, so the update re-renders unconditionally. */
  readonly relationshipUpdate: {
    readonly detail: PayloadDocumentEventDetail;
    readonly timestamp: number;
  };

  /** An error the runtime caught but cannot fully recover from. Branch on `code`; `context` is the human-readable origin. */
  readonly error: {
    readonly error: Error;
    readonly context: string;
    readonly code: DiagnosticCode;
  };

  /** During destroy, after observers and the message listener are removed; listeners are released by the owning client afterwards. */
  readonly destroy: { readonly timestamp: number };
}

/** Handlers may return a promise; they are awaited in registration order, which `beforeUpdate.cancel()` relies on. */
export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

export type Unsubscribe = () => void;
