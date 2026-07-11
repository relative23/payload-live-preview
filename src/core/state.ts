/**
 * Connection state + heartbeat.
 *
 * Tracks whether the runtime is currently receiving updates from a
 * trusted origin and fires a callback when the heartbeat times out.
 *
 * The heartbeat is reset on every valid message and considered dead
 * after `timeoutMs` of silence. The host typically responds by
 * re-sending the `ready` handshake to attempt reconnection.
 *
 * @module @core/state
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface HeartbeatOptions {
  /**
   * Milliseconds of silence before declaring a timeout. `0` disables
   * the timer entirely — the correct default for the real Payload
   * protocol, which sends messages only on form edits and therefore
   * has no keepalive: any idle-based timeout would produce false
   * disconnects while the editor simply isn't typing.
   */
  readonly timeoutMs?: number;
  /** Callback invoked when the heartbeat times out. */
  readonly onTimeout: () => void;
}

const DEFAULT_TIMEOUT_MS = 0;

/**
 * Heartbeat timer with `kick`/`stop` semantics. `kick()` is invoked
 * on every valid incoming message; if it is not called within
 * `timeoutMs` the `onTimeout` callback fires. A `timeoutMs` of `0`
 * (the default) disables the timer.
 */
export class HeartbeatTimer {
  readonly #timeoutMs: number;
  readonly #onTimeout: () => void;
  #handle: ReturnType<typeof setTimeout> | null = null;
  #lastKick = 0;

  constructor(options: HeartbeatOptions) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#onTimeout = options.onTimeout;
  }

  /** Reset the timer. Schedules `onTimeout` after `timeoutMs`. */
  kick(): void {
    this.#lastKick = Date.now();
    if (this.#timeoutMs <= 0) return;
    if (this.#handle !== null) clearTimeout(this.#handle);
    this.#handle = setTimeout(() => {
      this.#handle = null;
      this.#onTimeout();
    }, this.#timeoutMs);
  }

  /** Cancel any pending timeout. Safe to call repeatedly. */
  stop(): void {
    if (this.#handle === null) return;
    clearTimeout(this.#handle);
    this.#handle = null;
  }

  /** Test introspection: timestamp of the most recent kick (ms epoch). */
  get lastKickAt(): number {
    return this.#lastKick;
  }

  /** Test introspection: is a timeout currently scheduled? */
  get pending(): boolean {
    return this.#handle !== null;
  }
}

/**
 * Pure-data connection-status tracker. Exposes transitions through
 * a callback so the host can wire it to its event emitter.
 */
export class ConnectionState {
  #status: ConnectionStatus = 'disconnected';
  readonly #onChange: (next: ConnectionStatus, previous: ConnectionStatus) => void;

  constructor(onChange: (next: ConnectionStatus, previous: ConnectionStatus) => void) {
    this.#onChange = onChange;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  /** Mark as `connected`; idempotent. Returns true if state transitioned. */
  markConnected(): boolean {
    return this.#transition('connected');
  }

  /** Mark as `connecting`; idempotent. */
  markConnecting(): boolean {
    return this.#transition('connecting');
  }

  /** Mark as `disconnected`; idempotent. */
  markDisconnected(): boolean {
    return this.#transition('disconnected');
  }

  #transition(next: ConnectionStatus): boolean {
    if (this.#status === next) return false;
    const previous = this.#status;
    this.#status = next;
    this.#onChange(next, previous);
    return true;
  }
}
