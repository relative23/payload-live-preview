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
} from '@/types/payload-protocol';
import { LIBRARY_PROTOCOL_VERSION } from './protocol-version';

export type OriginMatcher = (origin: string) => boolean;

export interface MessageHandlers {
  /** Validated live preview data update. */
  readonly onUpdate: (msg: PayloadLivePreviewMessage, origin: string) => void;
  /** Validated document save event. */
  readonly onDocumentEvent: (msg: PayloadDocumentEventMessage, origin: string) => void;
  /**
   * Invoked when a message is rejected. Optional — used by debug logging.
   *
   * `reason` is one of `origin`, `shape`, `type`, `token`.
   */
  readonly onInvalid?: (reason: 'origin' | 'shape' | 'type' | 'token', origin: string) => void;
  /**
   * Optional preview-token gate. When set, every `payload-live-preview`
   * update message must carry a `previewToken` that this function
   * approves; otherwise the message is dropped with reason `'token'`.
   *
   * Returning a Promise is supported. Async validations are **serialised
   * in arrival order** through a single chain, so update A is always
   * dispatched before update B when A arrived first — even if B's
   * validation would otherwise resolve sooner. Validation errors are
   * treated as rejection (silent).
   */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
}

export class MessageBus {
  readonly #matcher: OriginMatcher;
  readonly #handlers: MessageHandlers;
  readonly #boundListener: (event: MessageEvent) => void;
  #attached = false;
  /**
   * Tail of the async token-validation chain. Each gated update appends
   * its validation to this promise, guaranteeing validations resolve —
   * and updates dispatch — in the order the messages arrived.
   */
  #validationChain: Promise<void> = Promise.resolve();

  constructor(matcher: OriginMatcher, handlers: MessageHandlers) {
    this.#matcher = matcher;
    this.#handlers = handlers;
    this.#boundListener = (event: MessageEvent): void => {
      this.#receive(event);
    };
  }

  /** Begin listening for window-level `message` events. Idempotent. */
  attach(target: Window = window): void {
    if (this.#attached) return;
    target.addEventListener('message', this.#boundListener);
    this.#attached = true;
  }

  /** Stop listening. Idempotent. */
  detach(target: Window = window): void {
    if (!this.#attached) return;
    target.removeEventListener('message', this.#boundListener);
    this.#attached = false;
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
          // postMessage can throw if the origin string is malformed.
          // Swallow silently — invalid origins are someone else's
          // configuration problem and we already log via onInvalid.
        }
      }
    }
  }

  #receive(event: MessageEvent): void {
    const origin = event.origin;
    if (!this.#matcher(origin)) {
      this.#handlers.onInvalid?.('origin', origin);
      return;
    }
    const data: unknown = event.data;
    if (!isObjectMessage(data)) {
      this.#handlers.onInvalid?.('shape', origin);
      return;
    }
    switch (data.type) {
      case 'payload-live-preview':
        if (!isLivePreviewMessage(data)) {
          this.#handlers.onInvalid?.('shape', origin);
          return;
        }
        this.#dispatchUpdate(data, origin);
        return;
      case 'payload-document-event':
        this.#handlers.onDocumentEvent(data as PayloadDocumentEventMessage, origin);
        return;
      default:
        this.#handlers.onInvalid?.('type', origin);
    }
  }

  #dispatchUpdate(message: PayloadLivePreviewMessage, origin: string): void {
    const validator = this.#handlers.validateToken;
    if (validator === undefined) {
      this.#handlers.onUpdate(message, origin);
      return;
    }
    // The `ready` handshake handshake doesn't carry a token; let it
    // through so the parent learns we're listening even when auth is
    // enabled. Only `data`-bearing updates are gated.
    if (message.ready === true && message.data === undefined) {
      this.#handlers.onUpdate(message, origin);
      return;
    }
    let approved: boolean | Promise<boolean>;
    try {
      approved = validator(message.previewToken, origin);
    } catch {
      this.#handlers.onInvalid?.('token', origin);
      return;
    }
    // Synchronous verdicts dispatch immediately and keep the natural
    // arrival order on their own.
    if (typeof approved === 'boolean') {
      if (approved) this.#handlers.onUpdate(message, origin);
      else this.#handlers.onInvalid?.('token', origin);
      return;
    }
    // Async verdicts are appended to a single chain so they resolve —
    // and dispatch — strictly in the order the messages arrived, even
    // when a later message's validation would settle first.
    this.#validationChain = this.#validationChain.then(async () => {
      let ok: boolean;
      try {
        ok = await approved;
      } catch {
        this.#handlers.onInvalid?.('token', origin);
        return;
      }
      if (ok) this.#handlers.onUpdate(message, origin);
      else this.#handlers.onInvalid?.('token', origin);
    });
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
 * number — is rejected), and the optional scalar fields to have the
 * right primitive types. Unknown extra fields are tolerated.
 */
function isLivePreviewMessage(value: { type: string }): value is PayloadLivePreviewMessage {
  const v = value as Record<string, unknown>;
  if (v['data'] !== undefined && !isPlainObject(v['data'])) return false;
  if (v['fieldSchemaJSON'] !== undefined && !Array.isArray(v['fieldSchemaJSON'])) return false;
  if (v['globalSlug'] !== undefined && typeof v['globalSlug'] !== 'string') return false;
  if (v['collectionSlug'] !== undefined && typeof v['collectionSlug'] !== 'string') return false;
  if (v['locale'] !== undefined && typeof v['locale'] !== 'string') return false;
  if (v['ready'] !== undefined && typeof v['ready'] !== 'boolean') return false;
  if (v['previewToken'] !== undefined && typeof v['previewToken'] !== 'string') return false;
  if (v['protocolVersion'] !== undefined && typeof v['protocolVersion'] !== 'number') return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
