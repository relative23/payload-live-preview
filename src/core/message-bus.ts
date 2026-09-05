/**
 * postMessage ingress: origin and source checks, per-type shape guards, the
 * ordered preview-token validation queue, and the `ready` handshake. The bus
 * never throws; a rejected message is dropped or reported via `onInvalid`.
 * Consumer callbacks may detach or re-attach the bus synchronously, so
 * anything that runs after one re-checks the generation it started in.
 * See ADR 0004.
 */

import type {
  PayloadDocumentEventMessage,
  PayloadLivePreviewMessage,
} from '@/types/payload-protocol';
import {
  focusFieldOf,
  isDocumentEventMessage,
  isLivePreviewMessage,
  isObjectMessage,
  isPlainObject,
  normalizeLivePreviewMessage,
} from './message-guards';
import { LIBRARY_PROTOCOL_VERSION } from './protocol-version';
import { observeThenableResult } from './thenable';

export type OriginMatcher = (origin: string) => boolean;

/** Identity of a data-bearing update: `revision` is monotonic, `generation` names the listener attachment. */
export interface MessageRevision {
  readonly revision: number;
  readonly generation: number;
}
export function sameRevision(a: MessageRevision, b: MessageRevision): boolean {
  return a.generation === b.generation && a.revision === b.revision;
}

export type InvalidReason = 'origin' | 'shape' | 'type' | 'token' | 'source';

export interface MessageHandlers {
  /** A validated update; data-bearing ones carry their revision, ready handshakes do not. */
  readonly onUpdate: (
    msg: PayloadLivePreviewMessage,
    origin: string,
    messageRevision?: MessageRevision,
  ) => void;
  readonly onDocumentEvent: (msg: PayloadDocumentEventMessage, origin: string) => void;
  /** The admin reports the cursor moved into a field (reveal tier 2). */
  readonly onFocusField?: (field: string, origin: string) => void;
  readonly onInvalid?: (reason: InvalidReason, origin: string) => void;
  /** `'parent-or-opener'` refuses every window but the framing/opening one, even from an allowed origin. */
  readonly sourcePolicy?: 'any' | 'parent-or-opener';
  /**
   * Gate for data-bearing updates. Verdicts commit in arrival order, so an
   * earlier update is dispatched before a later one even when its validation
   * resolves later; an error counts as rejection.
   */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
}

interface PendingValidation {
  readonly generation: number;
  readonly message: PayloadLivePreviewMessage;
  readonly origin: string;
  readonly messageRevision: MessageRevision | undefined;
  settled: boolean;
  approved: boolean;
}

/** Compact the consumed queue prefix only once it is both large and at least half the array. */
const QUEUE_COMPACTION_THRESHOLD = 1_024;

export class MessageBus {
  private readonly matcher: OriginMatcher;
  private readonly handlers: MessageHandlers;
  private boundListener: ((event: MessageEvent) => void) | undefined = undefined;
  private attachedTarget: Window | undefined = undefined;
  private generation = 0;
  private revision = 0;
  private queue: PendingValidation[] = [];
  private queueHead = 0;

  constructor(matcher: OriginMatcher, handlers: MessageHandlers) {
    this.matcher = matcher;
    this.handlers = handlers;
  }

  /** Start listening on `target`. Idempotent. */
  attach(target: Window = window): void {
    if (this.attachedTarget !== undefined) return;
    let committed = false;
    const listener = (event: MessageEvent): void => {
      // Each attachment owns its listener; a stale one must not borrow the new generation.
      if (!committed || this.boundListener !== listener) return;
      const generation = this.generation;
      try {
        this.receive(event, generation);
      } catch {
        // A synthetic event can carry throwing accessors; that is a shape failure.
        let origin: string;
        try {
          origin = event.origin;
        } catch {
          origin = '';
        }
        this.reportInvalid('shape', origin, generation);
      }
    };
    this.generation += 1;
    this.resetQueue();
    this.attachedTarget = target;
    this.boundListener = listener;
    try {
      target.addEventListener('message', listener);
    } catch (error) {
      // Invalidate before rollback: a hook may already have attached a newer generation.
      if (this.boundListener === listener) {
        this.attachedTarget = undefined;
        this.boundListener = undefined;
        this.resetQueue();
      }
      try {
        target.removeEventListener('message', listener);
      } catch {
        // Keep the original failure.
      }
      throw error;
    }
    if (this.boundListener === listener) {
      committed = true;
    } else {
      try {
        target.removeEventListener('message', listener);
      } catch {
        // The listener is identity-gated above even if removal fails.
      }
    }
  }

  /** Stop listening. Idempotent. */
  detach(): void {
    const target = this.attachedTarget;
    const listener = this.boundListener;
    if (target === undefined || listener === undefined) return;
    // Invalidate first so a listener already on the stack sees an obsolete generation.
    this.attachedTarget = undefined;
    this.boundListener = undefined;
    this.resetQueue();
    target.removeEventListener('message', listener);
  }

  /** Invalidate pending validations while staying attached (heartbeat expiry). */
  advanceGeneration(): boolean {
    if (this.attachedTarget === undefined) return false;
    this.generation += 1;
    this.resetQueue();
    return true;
  }

  /** Post the `ready` handshake to every target for every origin. */
  static sendReady(targets: readonly Window[], origins: readonly string[]): void {
    if (targets.length === 0 || origins.length === 0) return;
    const payload: PayloadLivePreviewMessage = {
      type: 'payload-live-preview',
      ready: true,
      protocolVersion: LIBRARY_PROTOCOL_VERSION,
    };
    for (const target of targets) {
      for (const origin of origins) {
        try {
          target.postMessage(payload, origin);
        } catch {
          // A malformed origin is the consumer's configuration problem.
        }
      }
    }
  }

  private receive(event: MessageEvent, generation: number): void {
    if (!this.isCurrentGeneration(generation)) return;
    const origin = event.origin;
    if (!this.matchesOrigin(origin, generation)) {
      this.reportInvalid('origin', origin, generation);
      return;
    }
    if (!this.matchesSource(event)) {
      this.reportInvalid('source', origin, generation);
      return;
    }
    const data: unknown = event.data;
    if (!isObjectMessage(data)) {
      this.reportInvalid('shape', origin, generation);
      return;
    }
    switch (data.type) {
      case 'payload-live-preview':
        if (!isLivePreviewMessage(data)) {
          this.reportInvalid('shape', origin, generation);
          return;
        }
        this.dispatchUpdate(normalizeLivePreviewMessage(data), origin, generation);
        return;
      case 'payload-document-event':
        if (!isDocumentEventMessage(data)) {
          this.reportInvalid('shape', origin, generation);
          return;
        }
        this.invokeHandler(generation, this.handlers.onDocumentEvent, data, origin);
        return;
      case 'payload-live-preview-focus': {
        const field = focusFieldOf(data);
        if (field === undefined) {
          this.reportInvalid('shape', origin, generation);
          return;
        }
        const onFocusField = this.handlers.onFocusField;
        if (onFocusField !== undefined) this.invokeHandler(generation, onFocusField, field, origin);
        return;
      }
      default:
        this.reportInvalid('type', origin, generation);
    }
  }

  private dispatchUpdate(
    message: PayloadLivePreviewMessage,
    origin: string,
    generation: number,
  ): void {
    const hasUpdateData = isPlainObject(message.data);
    if (!this.isCurrentGeneration(generation)) return;
    // A shape-valid data update consumes its revision before validation; a rejected token leaves a gap.
    const messageRevision = hasUpdateData
      ? { generation, revision: (this.revision += 1) }
      : undefined;
    const validator = this.handlers.validateToken;
    if (!this.isCurrentGeneration(generation)) return;
    if (validator === undefined) {
      this.commitUpdate(message, origin, generation, messageRevision);
      return;
    }
    // The data-less ready handshake carries no token and passes, so the admin learns we listen.
    if (message.ready === true && message.data === undefined) {
      this.commitUpdate(message, origin, generation, undefined);
      return;
    }
    const pending: PendingValidation = {
      generation,
      message,
      origin,
      messageRevision,
      settled: false,
      approved: false,
    };
    this.queue.push(pending);
    let verdict: unknown;
    try {
      // Invoked eagerly; only the commit waits for earlier queue entries.
      verdict = validator(message.previewToken, origin);
    } catch {
      this.settleValidation(pending, false);
      return;
    }
    if (typeof verdict === 'boolean') {
      this.settleValidation(pending, verdict);
      return;
    }
    // Assimilate any thenable; only literal `true` approves.
    void Promise.resolve(verdict).then(
      (approved) => {
        this.settleValidation(pending, approved === true);
      },
      () => {
        this.settleValidation(pending, false);
      },
    );
  }

  private settleValidation(pending: PendingValidation, approved: boolean): void {
    if (!this.isCurrentGeneration(pending.generation)) return;
    pending.approved = approved;
    pending.settled = true;
    this.drainQueue(pending.generation);
  }

  private drainQueue(generation: number): void {
    while (this.isCurrentGeneration(generation)) {
      const pending = this.queue[this.queueHead];
      if (pending === undefined) return;
      // The matcher may have narrowed since ingress (origin lock); an obsolete
      // origin must not hold the queue head and block the locked origin's work.
      if (!this.matchesOrigin(pending.origin, generation)) {
        if (!this.dequeue(pending)) continue;
        this.reportInvalid('origin', pending.origin, pending.generation);
        continue;
      }
      if (!pending.settled) return;
      if (!this.dequeue(pending)) continue;
      if (pending.approved) {
        this.commitUpdate(
          pending.message,
          pending.origin,
          pending.generation,
          pending.messageRevision,
        );
      } else {
        this.reportInvalid('token', pending.origin, pending.generation);
      }
    }
  }

  private commitUpdate(
    message: PayloadLivePreviewMessage,
    origin: string,
    generation: number,
    messageRevision: MessageRevision | undefined,
  ): void {
    if (!this.isCurrentGeneration(generation)) return;
    if (messageRevision === undefined) {
      this.invokeHandler(generation, this.handlers.onUpdate, message, origin);
    } else {
      this.invokeHandler(generation, this.handlers.onUpdate, message, origin, messageRevision);
    }
  }

  private reportInvalid(reason: InvalidReason, origin: string, generation: number): void {
    if (!this.isCurrentGeneration(generation)) return;
    const onInvalid = this.handlers.onInvalid;
    if (onInvalid !== undefined) this.invokeHandler(generation, onInvalid, reason, origin);
  }

  /** Under `'parent-or-opener'`, whether the event came from the attached window's parent or opener. */
  private matchesSource(event: MessageEvent): boolean {
    if (this.handlers.sourcePolicy !== 'parent-or-opener') return true;
    const target = this.attachedTarget;
    if (target === undefined) return false;
    try {
      const source = event.source;
      if (source === null) return false;
      const parent = target.parent;
      if (parent !== target && source === parent) return true;
      const opener: unknown = target.opener;
      return opener !== null && opener !== undefined && source === opener;
    } catch {
      return false;
    }
  }

  /** Fail-closed: only literal `true` from the matcher, and only within the generation it ran in. */
  private matchesOrigin(origin: string, generation: number): boolean {
    if (!this.isCurrentGeneration(generation)) return false;
    try {
      const approved: unknown = this.matcher(origin);
      return approved === true && this.isCurrentGeneration(generation);
    } catch {
      return false;
    }
  }

  /** Callbacks run only in a current generation and must not unwind the listener or the drain. */
  private invokeHandler<TArgs extends unknown[]>(
    generation: number,
    handler: (...args: TArgs) => unknown,
    ...args: TArgs
  ): void {
    if (!this.isCurrentGeneration(generation)) return;
    try {
      observeThenableResult(handler(...args));
    } catch {
      // Isolated by contract.
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.attachedTarget !== undefined && this.generation === generation;
  }

  /** Advance the head past `expected`, unless a matcher reset the queue meanwhile. */
  private dequeue(expected: PendingValidation): boolean {
    if (this.queue[this.queueHead] !== expected) return false;
    this.queueHead += 1;
    if (this.queueHead === this.queue.length) {
      this.resetQueue();
      return true;
    }
    if (this.queueHead >= QUEUE_COMPACTION_THRESHOLD && this.queueHead * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
    return true;
  }

  private resetQueue(): void {
    this.queue = [];
    this.queueHead = 0;
  }
}
