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
  private lastKick: number | null = null;

  constructor(options: HeartbeatOptions) {
    this.timeoutMs = options.timeoutMs ?? 0;
    this.onTimeout = options.onTimeout;
  }

  /** Called on every valid message; re-arms the timeout. */
  kick(): void {
    this.lastKick = Date.now();
    if (this.timeoutMs <= 0) return;
    this.stop();
    this.arm(this.timeoutMs);
  }

  /**
   * Re-arm after a lifecycle pause without granting a fresh trust window.
   * Returns whether the old deadline expired while the timer was stopped.
   */
  resume(): boolean {
    if (this.timeoutMs <= 0 || this.handle !== null || this.lastKick === null) return false;
    const elapsed = Math.max(0, Date.now() - this.lastKick);
    const remaining = this.timeoutMs - elapsed;
    if (remaining <= 0) {
      this.lastKick = null;
      this.onTimeout();
      return true;
    }
    this.arm(Math.min(remaining, this.timeoutMs));
    return false;
  }

  private arm(delay: number): void {
    const handle = setTimeout(() => {
      if (this.handle !== handle) return;
      this.handle = null;
      this.lastKick = null;
      this.onTimeout();
    }, delay);
    this.handle = handle;
  }

  stop(): void {
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
  }

  get lastKickAt(): number {
    return this.lastKick ?? 0;
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
