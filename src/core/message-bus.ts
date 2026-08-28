/**
 * Message bus — postMessage receive + send with strict validation.
 *
 * Responsibilities:
 *
 *   1. Subscribe to the `message` event and reject anything that does
 *      not come from a trusted origin (matcher injected by the caller).
 *   2. Validate message shape with a per-type guard before exposing the
 *      payload downstream: a `payload-live-preview` update must carry a
 *      `data` object (or none, for the `ready` handshake); anything
 *      whose `data` is a non-object is dropped as `'shape'`. So the
 *      `PayloadLivePreviewMessage.data?: Record<string, unknown>` type
 *      is genuinely enforced at runtime, not just asserted.
 *   3. Send the `ready` handshake to potential parent windows.
 *
 * The matcher pattern decouples origin policy from message handling:
 *   - the runtime's origin detector decides which origins are valid;
 *   - the bus simply asks "is this origin valid?" for every message.
 *
 * The bus never throws. Every validation failure becomes either a
 * silent drop or a routed `onInvalid` callback.
 *
 * @module @core/message-bus
 */

import type {
  PayloadLivePreviewMessage,
  PayloadDocumentEventMessage,
  PayloadFieldSchema,
} from '@/types/payload-protocol';
import { parseFieldSchema } from '@schema/parser';
import { LIBRARY_PROTOCOL_VERSION } from './protocol-version';
import { observeThenableResult } from './thenable';

export type OriginMatcher = (origin: string) => boolean;

/**
 * Stable identity assigned to a data-bearing update at message ingress.
 *
 * `revision` is monotonic for the lifetime of one `MessageBus` instance.
 * `generation` identifies the listener attachment in which the message
 * arrived; work from a detached generation is never dispatched.
 */
export interface MessageRevision {
  readonly revision: number;
  readonly generation: number;
}

export interface MessageHandlers {
  /**
   * Validated live-preview message. Data-bearing updates include their
   * revision identity; data-less ready handshakes intentionally do not.
   */
  readonly onUpdate: (
    msg: PayloadLivePreviewMessage,
    origin: string,
    messageRevision?: MessageRevision,
  ) => void;
  /** Validated document save event. */
  readonly onDocumentEvent: (msg: PayloadDocumentEventMessage, origin: string) => void;
  /**
   * The admin reports the editor's cursor moved into a field, so the preview
   * can reveal it. Optional — used only by consumers that wire the focus
   * reporter into their Payload admin (roadmap 2.0 "reveal the edited section",
   * tier 2).
   */
  readonly onFocusField?: (field: string, origin: string) => void;
  /**
   * Invoked when a message is rejected. Optional — used by debug logging.
   *
   * `reason` is one of `origin`, `shape`, `type`, `token`.
   */
  readonly onInvalid?: (
    reason: 'origin' | 'shape' | 'type' | 'token' | 'source',
    origin: string,
  ) => void;
  /**
   * Which windows may post updates. `'parent-or-opener'` accepts only the
   * attached window's parent (when framed) or opener (when popped up) and
   * refuses every other source with reason `'source'` — a same-origin
   * sibling frame, or a script on the page itself, cannot then drive the
   * preview even though its origin passes the allow-list. Default `'any'`.
   */
  readonly sourcePolicy?: 'any' | 'parent-or-opener';
  /**
   * Optional preview-token gate. When set, every `payload-live-preview`
   * update message must carry a `previewToken` that this function
   * approves; otherwise the message is dropped with reason `'token'`.
   *
   * Returning a Promise is supported. Async validations are **serialised
   * in arrival order** through a single chain, so update A is always
   * dispatched before update B when A arrived first — even if B's
   * validation would otherwise resolve sooner. Validation errors are
   * treated as rejection and routed to `onInvalid('token')` when provided.
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

/**
 * A consumed prefix is compacted only after it is both substantial and at
 * least half of the backing array. This bounds retained settled entries while
 * keeping dequeue amortized O(1); a fully drained or invalidated generation
 * always drops the backing array immediately.
 */
const VALIDATION_QUEUE_COMPACTION_THRESHOLD = 1_024;

const enum BusSlot {
  Matcher,
  Handlers,
  BoundListener,
  AttachedTarget,
  Generation,
  Revision,
  ValidationQueue,
  ValidationQueueHead,
}

/**
 * One TS-private record keeps all mutable ingress state instance-local while
 * avoiding private-field lowering in the ES2020 inline build. Named slots
 * preserve queue and generation invariants without property-name mangling;
 * this internal class never crosses the package boundary.
 */
type MessageBusState = [
  matcher: OriginMatcher,
  handlers: MessageHandlers,
  boundListener: ((event: MessageEvent) => void) | undefined,
  attachedTarget: Window | undefined,
  generation: number,
  revision: number,
  validationQueue: PendingValidation[],
  validationQueueHead: number,
];

export class MessageBus {
  private readonly s: MessageBusState;
  /**
   * Validator calls start eagerly, but their outcomes commit from the
   * head of this queue. This deliberately includes booleans and thrown
   * errors: a synchronous result can never overtake an older promise.
   * Detach replaces the queue, so a new generation is never blocked by
   * unresolved work from its predecessor.
   */
  constructor(matcher: OriginMatcher, handlers: MessageHandlers) {
    this.s = [matcher, handlers, undefined, undefined, 0, 0, [], 0];
  }

  /** Begin listening for window-level `message` events. Idempotent. */
  attach(target: Window = window): void {
    if (this.s[BusSlot.AttachedTarget] !== undefined) return;
    let committed = false;
    const listener = (event: MessageEvent): void => {
      // Each attachment owns a distinct listener. An ineffectively removed
      // listener from an older transaction must not borrow the new generation.
      if (!committed || this.s[BusSlot.BoundListener] !== listener) return;
      const generation = this.s[BusSlot.Generation];
      try {
        this.#receive(event, generation);
      } catch {
        // The guards below deliberately handle every expected protocol failure.
        // Keep one final trust-boundary safety net for hostile accessors or other
        // unexpected JavaScript values delivered through postMessage.
        let origin = '';
        try {
          origin = event.origin;
        } catch {
          // A synthetic MessageEvent can itself expose hostile accessors.
        }
        this.#reportInvalid('shape', origin, generation);
      }
    };
    this.s[BusSlot.Generation] += 1;
    this.#resetValidationQueue();
    this.s[BusSlot.AttachedTarget] = target;
    this.s[BusSlot.BoundListener] = listener;
    try {
      target.addEventListener('message', listener);
    } catch (error) {
      // Invalidate this attempt before external rollback. A remove hook may
      // attach a newer generation, which this older catch must not clobber.
      if (this.s[BusSlot.BoundListener] === listener) {
        this.s[BusSlot.AttachedTarget] = undefined;
        this.s[BusSlot.BoundListener] = undefined;
        this.#resetValidationQueue();
      }
      try {
        target.removeEventListener('message', listener);
      } catch {
        // Preserve the original addEventListener failure.
      }
      throw error;
    }
    // addEventListener is a host boundary. Reentrant detach/attach may have
    // installed a newer resource; remove only this attempt's unique listener.
    if (this.s[BusSlot.BoundListener] === listener) {
      committed = true;
    } else {
      try {
        target.removeEventListener('message', listener);
      } catch {
        // The obsolete listener is identity-gated above even if removal fails.
      }
    }
  }

  /** Stop listening. Idempotent. */
  detach(_target?: Window): void {
    const target = this.s[BusSlot.AttachedTarget];
    const listener = this.s[BusSlot.BoundListener];
    if (target === undefined || listener === undefined) return;

    // Invalidate first. A listener already on the stack, or a validator
    // settling during removal, must observe the generation as obsolete.
    this.s[BusSlot.AttachedTarget] = undefined;
    this.s[BusSlot.BoundListener] = undefined;
    this.#resetValidationQueue();
    target.removeEventListener('message', listener);
  }

  /**
   * Invalidate every pending validation while keeping the current listener
   * attached. Used when the surrounding connection lifecycle expires: work
   * accepted after this point belongs to a fresh generation and cannot be
   * blocked or revived by an older validator.
   */
  advanceGeneration(): boolean {
    if (this.s[BusSlot.AttachedTarget] === undefined) return false;
    this.s[BusSlot.Generation] += 1;
    this.#resetValidationQueue();
    return true;
  }

  /**
   * Send a `ready` handshake message to one or more parent windows.
   *
   * `targets` are the windows to notify (parent and/or opener). For
   * each target the message is sent to every `origin` so the Payload
   * admin in the parent receives it regardless of which origin it
   * happens to be served on.
   */
  static sendReady(targets: readonly Window[], origins: readonly string[]): void {
    const hasTargets = targets.length > 0;
    if (!hasTargets || origins.length === 0) return;
    const payload: PayloadLivePreviewMessage = {
      type: 'payload-live-preview',
      // Keep this as a runtime boolean expression. The inline build compacts
      // literal booleans, but the ready handshake must remain a real boolean.
      ready: hasTargets,
      protocolVersion: LIBRARY_PROTOCOL_VERSION,
    };
    for (const target of targets) {
      for (const origin of origins) {
        try {
          target.postMessage(payload, origin);
        } catch {
          // postMessage can throw if the origin string is malformed.
          // Swallow silently — invalid origins are someone else's
          // configuration problem and we already log via onInvalid.
        }
      }
    }
  }

  #receive(event: MessageEvent, generation: number): void {
    if (!this.#isCurrentGeneration(generation)) return;

    // Every read below can cross user-controlled JavaScript through a
    // synthetic MessageEvent, Proxy, accessor, schema value, or callback.
    // Re-check the captured generation after each such boundary so re-entry
    // cannot continue an obsolete ingress into the fresh validation queue.
    const origin = event.origin;
    if (!this.#isCurrentGeneration(generation)) return;
    if (!this.#matchesOrigin(origin, generation)) {
      this.#reportInvalid('origin', origin, generation);
      return;
    }
    if (!this.#matchesSource(event)) {
      this.#reportInvalid('source', origin, generation);
      return;
    }
    if (!this.#isCurrentGeneration(generation)) return;

    const data: unknown = event.data;
    if (!this.#isCurrentGeneration(generation)) return;
    const isMessage = isObjectMessage(data);
    if (!this.#isCurrentGeneration(generation)) return;
    if (!isMessage) {
      this.#reportInvalid('shape', origin, generation);
      return;
    }

    const type = data.type;
    if (!this.#isCurrentGeneration(generation)) return;
    switch (type) {
      case 'payload-live-preview': {
        const isLivePreview = isLivePreviewMessage(data);
        if (!this.#isCurrentGeneration(generation)) return;
        if (!isLivePreview) {
          this.#reportInvalid('shape', origin, generation);
          return;
        }
        const message = normalizeLivePreviewMessage(data);
        if (!this.#isCurrentGeneration(generation)) return;
        this.#dispatchUpdate(message, origin, generation);
        return;
      }
      case 'payload-document-event': {
        const isDocumentEvent = isDocumentEventMessage(data);
        if (!this.#isCurrentGeneration(generation)) return;
        if (!isDocumentEvent) {
          this.#reportInvalid('shape', origin, generation);
          return;
        }
        let onDocumentEvent: MessageHandlers['onDocumentEvent'];
        try {
          onDocumentEvent = this.s[BusSlot.Handlers].onDocumentEvent;
        } catch {
          return;
        }
        if (!this.#isCurrentGeneration(generation)) return;
        this.#invokeHandler(onDocumentEvent, data, origin);
        return;
      }
      case 'payload-live-preview-focus': {
        const field = focusFieldOf(data);
        if (!this.#isCurrentGeneration(generation)) return;
        if (field === undefined) {
          this.#reportInvalid('shape', origin, generation);
          return;
        }
        const onFocusField = this.s[BusSlot.Handlers].onFocusField;
        if (onFocusField === undefined) return;
        if (!this.#isCurrentGeneration(generation)) return;
        try {
          onFocusField(field, origin);
        } catch {
          // A consumer handler that throws must not take the bus down.
        }
        return;
      }
      default:
        this.#reportInvalid('type', origin, generation);
    }
  }

  #dispatchUpdate(message: PayloadLivePreviewMessage, origin: string, generation: number): void {
    if (!this.#isCurrentGeneration(generation)) return;

    const data = message.data;
    if (!this.#isCurrentGeneration(generation)) return;
    const hasUpdateData = isPlainObject(data);
    if (!this.#isCurrentGeneration(generation)) return;

    // Shape-valid data updates consume their revision before validation.
    // A rejected token therefore leaves an intentional gap.
    const messageRevision = hasUpdateData
      ? { generation, revision: (this.s[BusSlot.Revision] += 1) }
      : undefined;
    let validator: MessageHandlers['validateToken'];
    try {
      validator = this.s[BusSlot.Handlers].validateToken;
    } catch {
      return;
    }
    if (!this.#isCurrentGeneration(generation)) return;
    if (validator === undefined) {
      this.#commitUpdate(message, origin, generation, messageRevision);
      return;
    }
    // The `ready` handshake doesn't carry a token; let it
    // through so the parent learns we're listening even when auth is
    // enabled. Only `data`-bearing updates are gated.
    if (message.ready === true && data === undefined) {
      this.#commitUpdate(message, origin, generation, undefined);
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
    this.s[BusSlot.ValidationQueue].push(pending);

    let verdict: unknown;
    try {
      // Invocation is intentionally eager. Only committing the outcome
      // waits for earlier queue entries.
      verdict = validator(message.previewToken, origin);
    } catch {
      this.#settleValidation(pending, false);
      return;
    }

    if (typeof verdict === 'boolean') {
      this.#settleValidation(pending, verdict);
      return;
    }

    // Normalize even an incorrectly typed JavaScript return value through a
    // real Promise. This safely assimilates thenables (including a throwing
    // `then` getter), while the literal-true comparison below fails closed for
    // strings, objects, and every other non-boolean fulfillment.
    void Promise.resolve(verdict).then(
      (approved) => {
        this.#settleValidation(pending, approved === true);
      },
      () => {
        this.#settleValidation(pending, false);
      },
    );
  }

  #settleValidation(pending: PendingValidation, approved: boolean): void {
    if (!this.#isCurrentGeneration(pending.generation)) return;
    pending.approved = approved;
    pending.settled = true;
    this.#drainValidationQueue(pending.generation);
  }

  #drainValidationQueue(generation: number): void {
    while (this.#isCurrentGeneration(generation)) {
      const pending = this.s[BusSlot.ValidationQueue][this.s[BusSlot.ValidationQueueHead]];
      if (pending === undefined) return;

      // The matcher may have narrowed since ingress (for example the client
      // locks to the first committed origin). Re-check at the ordered commit
      // boundary before waiting for the verdict. An obsolete origin must not
      // retain the queue head and block newer work from the locked origin.
      if (!this.#matchesOrigin(pending.origin, generation)) {
        if (!this.#dequeueValidation(pending)) continue;
        this.#reportInvalid('origin', pending.origin, pending.generation);
        continue;
      }
      if (!pending.settled) return;
      if (!this.#dequeueValidation(pending)) continue;

      if (pending.approved) {
        this.#commitUpdate(
          pending.message,
          pending.origin,
          pending.generation,
          pending.messageRevision,
        );
      } else {
        this.#reportInvalid('token', pending.origin, pending.generation);
      }
    }
  }

  #commitUpdate(
    message: PayloadLivePreviewMessage,
    origin: string,
    generation: number,
    messageRevision: MessageRevision | undefined,
  ): void {
    if (!this.#isCurrentGeneration(generation)) return;
    let onUpdate: MessageHandlers['onUpdate'];
    try {
      onUpdate = this.s[BusSlot.Handlers].onUpdate;
    } catch {
      return;
    }
    if (!this.#isCurrentGeneration(generation)) return;
    if (messageRevision === undefined) {
      this.#invokeHandler(onUpdate, message, origin);
    } else {
      this.#invokeHandler(onUpdate, message, origin, messageRevision);
    }
  }

  #reportInvalid(
    reason: 'origin' | 'shape' | 'type' | 'token' | 'source',
    origin: string,
    generation: number,
  ): void {
    if (!this.#isCurrentGeneration(generation)) return;
    let onInvalid: MessageHandlers['onInvalid'];
    try {
      onInvalid = this.s[BusSlot.Handlers].onInvalid;
    } catch {
      return;
    }
    if (!this.#isCurrentGeneration(generation)) return;
    if (onInvalid !== undefined) {
      this.#invokeHandler(onInvalid, reason, origin);
    }
  }

  /** Origin policy is a fail-closed trust boundary, including faulty matchers. */
  /**
   * Under `'parent-or-opener'`, whether the event came from the attached
   * window's parent or opener. Reading `event.source` crosses into a possibly
   * synthetic event, so a throwing accessor counts as a mismatch.
   */
  #matchesSource(event: MessageEvent): boolean {
    if (this.s[BusSlot.Handlers].sourcePolicy !== 'parent-or-opener') return true;
    const target = this.s[BusSlot.AttachedTarget];
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

  #matchesOrigin(origin: string, generation: number): boolean {
    if (!this.#isCurrentGeneration(generation)) return false;
    try {
      // Treat this as an untyped JavaScript boundary despite the TypeScript
      // signature: only literal `true` grants trust, and that approval belongs
      // only to the generation in which the matcher was invoked.
      const approved: unknown = this.s[BusSlot.Matcher](origin);
      return approved === true && this.#isCurrentGeneration(generation);
    } catch {
      return false;
    }
  }

  /**
   * Consumer callbacks cannot be allowed to unwind the window listener or the
   * ordered validation drain.
   */
  #invokeHandler<TArgs extends unknown[]>(
    handler: (...args: TArgs) => unknown,
    ...args: TArgs
  ): void {
    try {
      observeThenableResult(handler(...args));
    } catch {
      // Boundary callbacks are isolated by contract; the bus keeps draining.
    }
  }

  #isCurrentGeneration(generation: number): boolean {
    return (
      this.s[BusSlot.AttachedTarget] !== undefined && this.s[BusSlot.Generation] === generation
    );
  }

  #dequeueValidation(expected: PendingValidation): boolean {
    // Origin matchers are consumer callbacks. They may synchronously advance
    // the generation and reset the queue during the commit-boundary recheck;
    // never move the fresh generation's head on behalf of the old entry.
    const state = this.s;
    if (state[BusSlot.ValidationQueue][state[BusSlot.ValidationQueueHead]] !== expected) {
      return false;
    }
    state[BusSlot.ValidationQueueHead] += 1;
    if (state[BusSlot.ValidationQueueHead] === state[BusSlot.ValidationQueue].length) {
      this.#resetValidationQueue();
      return true;
    }
    if (
      state[BusSlot.ValidationQueueHead] >= VALIDATION_QUEUE_COMPACTION_THRESHOLD &&
      state[BusSlot.ValidationQueueHead] * 2 >= state[BusSlot.ValidationQueue].length
    ) {
      state[BusSlot.ValidationQueue] = state[BusSlot.ValidationQueue].slice(
        state[BusSlot.ValidationQueueHead],
      );
      state[BusSlot.ValidationQueueHead] = 0;
    }
    return true;
  }

  #resetValidationQueue(): void {
    this.s[BusSlot.ValidationQueue] = [];
    this.s[BusSlot.ValidationQueueHead] = 0;
  }
}

/**
 * Shallow guard: is this an object carrying a string `type`? Enough to
 * route by type; the per-type guards below enforce the payload shape.
 */
function isObjectMessage(value: unknown): value is { type: string } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value)) return false;
  return typeof value.type === 'string';
}

/**
 * Full guard for a `payload-live-preview` message. Requires `data` to be
 * a plain object when present (a non-object `data` — string, array,
 * number — is rejected), and each optional scalar to have the right
 * primitive type *or* be absent. `null` counts as absent: the real
 * Payload admin sends `collectionSlug: undefined` for a global, and a
 * JSON round-trip (or some serializers) turns that into `null` — both
 * mean "no value", not "malformed". Unknown extra fields (e.g.
 * `externallyUpdatedRelationship`) are tolerated.
 */
function isLivePreviewMessage(value: { type: string }): value is PayloadLivePreviewMessage {
  const v = value as Record<string, unknown>;
  if (v['data'] !== undefined && v['data'] !== null && !isPlainObject(v['data'])) return false;
  if (!optionalTypeOk(v['fieldSchemaJSON'], (x) => Array.isArray(x))) return false;
  if (!optionalTypeOk(v['globalSlug'], (x) => typeof x === 'string')) return false;
  if (!optionalTypeOk(v['collectionSlug'], (x) => typeof x === 'string')) return false;
  if (!optionalTypeOk(v['locale'], (x) => typeof x === 'string')) return false;
  if (!optionalTypeOk(v['ready'], (x) => typeof x === 'boolean')) return false;
  if (!optionalTypeOk(v['previewToken'], (x) => typeof x === 'string')) return false;
  if (!optionalTypeOk(v['protocolVersion'], (x) => typeof x === 'number')) return false;
  return true;
}

/**
 * Runtime guard for Payload's document-save notification. Stock Payload
 * sends only the `type`; custom senders may add the optional typed fields.
 */
/**
 * The field name from a `payload-live-preview-focus` message, or undefined when
 * the shape is wrong. The message is `{ type, field: string }`; a non-empty
 * string field is required.
 */
function focusFieldOf(value: { type: string }): string | undefined {
  const field = (value as Record<string, unknown>)['field'];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function isDocumentEventMessage(value: { type: string }): value is PayloadDocumentEventMessage {
  const v = value as Record<string, unknown>;
  if (
    !optionalDocumentFieldOk(
      v['action'],
      (x) => x === 'updated' || x === 'created' || x === 'deleted',
    )
  ) {
    return false;
  }
  if (!optionalDocumentFieldOk(v['slug'], (x) => typeof x === 'string')) return false;
  if (
    !optionalDocumentFieldOk(
      v['id'],
      (x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)),
    )
  ) {
    return false;
  }
  return true;
}

/** Document-event extensions use omission, not `null`, for absence. */
function optionalDocumentFieldOk(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

/** `undefined`/`null` (absent) pass; otherwise the value must match `check`. */
function optionalTypeOk(value: unknown, check: (v: unknown) => boolean): boolean {
  if (value === undefined || value === null) return true;
  return check(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

const NULL_AS_ABSENT_FIELDS = [
  'data',
  'fieldSchemaJSON',
  'globalSlug',
  'collectionSlug',
  'locale',
  'ready',
  'previewToken',
  'protocolVersion',
] as const satisfies readonly (keyof PayloadLivePreviewMessage)[];

/**
 * Normalize the permissive wire boundary into the stricter public type.
 *
 * Payload/JSON bridges may encode absent optional properties as `null`; the
 * guard accepts that representation, so it must be removed before downstream
 * classification (especially the data-less ready handshake). Unknown fields,
 * including Payload's nullable relationship event, remain untouched for
 * protocol evolution.
 *
 * The schema guard establishes only that the outer value is an array;
 * `parseFieldSchema()` validates every nested entry and drops malformed ones.
 * A defensive catch also contains pathological cyclic/deep values supplied by
 * direct JavaScript `MessageEvent` construction.
 */
function normalizeLivePreviewMessage(
  message: PayloadLivePreviewMessage,
): PayloadLivePreviewMessage {
  const normalized = { ...message };
  for (const field of NULL_AS_ABSENT_FIELDS) {
    const wireValue: unknown = Reflect.get(normalized, field);
    if (wireValue === null) Reflect.deleteProperty(normalized, field);
  }
  if (!Array.isArray(normalized.fieldSchemaJSON)) return normalized;
  let fieldSchemaJSON: readonly PayloadFieldSchema[];
  try {
    fieldSchemaJSON = parseFieldSchema(normalized.fieldSchemaJSON);
  } catch {
    fieldSchemaJSON = [];
  }
  return { ...normalized, fieldSchemaJSON };
}
