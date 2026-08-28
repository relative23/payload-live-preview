/** Connection status and the heartbeat that decides a disconnect. */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface HeartbeatOptions {
  /**
   * Silence before declaring a timeout. `0` disables the timer, which is right
   * for the stock Payload protocol: it sends messages only on edits, so any
   * idle timeout would report false disconnects.
   */
  readonly timeoutMs?: number;
  readonly onTimeout: () => void;
}

export class HeartbeatTimer {
  private readonly timeoutMs: number;
  private readonly onTimeout: () => void;
  private handle: ReturnType<typeof setTimeout> | null = null;
  private lastKick = 0;

  constructor(options: HeartbeatOptions) {
    this.timeoutMs = options.timeoutMs ?? 0;
    this.onTimeout = options.onTimeout;
  }

  /** Called on every valid message; re-arms the timeout. */
  kick(): void {
    this.lastKick = Date.now();
    if (this.timeoutMs <= 0) return;
    if (this.handle !== null) clearTimeout(this.handle);
    const handle = setTimeout(() => {
      if (this.handle !== handle) return;
      this.handle = null;
      this.onTimeout();
    }, this.timeoutMs);
    this.handle = handle;
  }

  stop(): void {
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
  }

  get lastKickAt(): number {
    return this.lastKick;
  }

  get pending(): boolean {
    return this.handle !== null;
  }
}

export class ConnectionState {
  private current: ConnectionStatus = 'disconnected';

  get status(): ConnectionStatus {
    return this.current;
  }

  /** Returns whether the status changed. */
  markConnected(): boolean {
    return this.transition('connected');
  }

  markDisconnected(): boolean {
    return this.transition('disconnected');
  }

  private transition(next: ConnectionStatus): boolean {
    if (this.current === next) return false;
    this.current = next;
    return true;
  }
}
