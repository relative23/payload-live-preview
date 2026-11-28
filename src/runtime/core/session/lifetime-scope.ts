/**
 * A lifetime scope: what is owned inside it is released together, in reverse
 * order, when it closes, each release guarded so one that throws does not
 * stop the rest. The runtime opens one per session (`start()`) and closes it
 * on `destroy()`, `suspend()` and a failed start alike (ADR 0005, 2.1 note).
 * The plugin manager's `ResourceScope` is the same idea with staging, commit
 * and per-kind counts on top; this is the form the inline runtime carries.
 */

export type Release = () => void;

export class LifetimeScope {
  readonly #owned: Release[] = [];
  readonly #log: (...args: unknown[]) => void;
  #closed = false;

  constructor(log: (...args: unknown[]) => void) {
    this.#log = log;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Own a release; a closed scope runs it at once. */
  own(release: Release): void {
    if (this.#closed) {
      this.#run(release);
      return;
    }
    this.#owned.push(release);
  }

  /** Release everything owned, the last first; idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const owned = this.#owned.splice(0).reverse();
    for (const release of owned) this.#run(release);
  }

  #run(release: Release): void {
    try {
      release();
    } catch (error) {
      this.#log('runtime cleanup failed:', error);
    }
  }
}
