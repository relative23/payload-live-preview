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

const enum HeartbeatSlot {
  TimeoutMs,
  OnTimeout,
  Handle,
  LastKick,
}

type HeartbeatState = [
  timeoutMs: number,
  onTimeout: () => void,
  handle: ReturnType<typeof setTimeout> | null,
  lastKick: number,
];

/**
 * Heartbeat timer with `kick`/`stop` semantics. `kick()` is invoked
 * on every valid incoming message; if it is not called within
 * `timeoutMs` the `onTimeout` callback fires. A `timeoutMs` of `0`
 * (the default) disables the timer.
 */
export class HeartbeatTimer {
  private readonly s: HeartbeatState;

  constructor(options: HeartbeatOptions) {
    this.s = [options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.onTimeout, null, 0];
  }

  /** Reset the timer. Schedules `onTimeout` after `timeoutMs`. */
  kick(): void {
    this.s[HeartbeatSlot.LastKick] = Date.now();
    if (this.s[HeartbeatSlot.TimeoutMs] <= 0) return;
    if (this.s[HeartbeatSlot.Handle] !== null) {
      clearTimeout(this.s[HeartbeatSlot.Handle]);
    }
    const handle = setTimeout(() => {
      if (this.s[HeartbeatSlot.Handle] !== handle) return;
      this.s[HeartbeatSlot.Handle] = null;
      this.s[HeartbeatSlot.OnTimeout]();
    }, this.s[HeartbeatSlot.TimeoutMs]);
    this.s[HeartbeatSlot.Handle] = handle;
  }

  /** Cancel any pending timeout. Safe to call repeatedly. */
  stop(): void {
    if (this.s[HeartbeatSlot.Handle] === null) return;
    clearTimeout(this.s[HeartbeatSlot.Handle]);
    this.s[HeartbeatSlot.Handle] = null;
  }

  /** Test introspection: timestamp of the most recent kick (ms epoch). */
  get lastKickAt(): number {
    return this.s[HeartbeatSlot.LastKick];
  }

  /** Test introspection: is a timeout currently scheduled? */
  get pending(): boolean {
    return this.s[HeartbeatSlot.Handle] !== null;
  }
}

/**
 * Pure-data connection-status tracker. Exposes transitions through
 * a callback so the host can wire it to its event emitter.
 */
export class ConnectionState {
  private readonly s: [
    status: ConnectionStatus,
    onChange: (next: ConnectionStatus, previous: ConnectionStatus) => void,
  ];

  constructor(onChange: (next: ConnectionStatus, previous: ConnectionStatus) => void) {
    this.s = ['disconnected', onChange];
  }

  get status(): ConnectionStatus {
    return this.s[0];
  }

  /** Mark as `connected`; idempotent. Returns true if state transitioned. */
  markConnected(): boolean {
    return this.transition('connected');
  }

  /** Mark as `connecting`; idempotent. */
  markConnecting(): boolean {
    return this.transition('connecting');
  }

  /** Mark as `disconnected`; idempotent. */
  markDisconnected(): boolean {
    return this.transition('disconnected');
  }

  private transition(next: ConnectionStatus): boolean {
    if (this.s[0] === next) return false;
    const previous = this.s[0];
    this.s[0] = next;
    this.s[1](next, previous);
    return true;
  }
}
