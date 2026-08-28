/**
 * Registration-local resource scope: every listener, transform, renderer
 * layer and cleanup a plugin registers is staged here until `init` commits
 * and released together, in reverse order, when the plugin goes. See ADR 0005.
 */

import { observeThenableResult } from '@core/thenable';
import type { PluginDisposer } from './types';

export type ResourceKind = 'transform' | 'renderer' | 'subscription' | 'cleanup';

interface ScopedResource {
  readonly kind: ResourceKind;
  readonly acquire: (() => PluginDisposer | undefined) | undefined;
  readonly finalize: (() => void) | undefined;
  cleanup: PluginDisposer | undefined;
  disposed: boolean;
}

export const noopDisposer: PluginDisposer = () => undefined;

export class ResourceScope {
  readonly #pluginName: string;
  readonly #log: (...args: unknown[]) => void;
  // Insertion order gives commit/reverse-teardown order; short-lived entries
  // (once listeners) leave immediately instead of accumulating until removal.
  readonly #resources = new Set<ScopedResource>();
  #state: 'staging' | 'committing' | 'active' | 'closed' = 'staging';

  constructor(pluginName: string, log: (...args: unknown[]) => void) {
    this.#pluginName = pluginName;
    this.#log = log;
  }

  assertOpen(): void {
    if (this.#state === 'closed') {
      throw new Error(`Plugin context for "${this.#pluginName}" is no longer active`);
    }
  }

  get active(): boolean {
    return this.#state === 'active';
  }

  /** Whether a retained context still belongs to this registration. */
  eligible(): boolean {
    return this.#state !== 'closed';
  }

  /** Own a resource the plugin itself already acquired. */
  own(cleanup: PluginDisposer): PluginDisposer {
    this.assertOpen();
    return this.#track({
      kind: 'cleanup',
      acquire: undefined,
      finalize: undefined,
      cleanup,
      disposed: false,
    });
  }

  /** Stage a manager-owned resource; an active scope acquires it at once. */
  stage(
    kind: ResourceKind,
    acquire: () => PluginDisposer | undefined,
    finalize?: () => void,
  ): PluginDisposer {
    this.assertOpen();
    const resource: ScopedResource = {
      kind,
      acquire,
      finalize,
      cleanup: undefined,
      disposed: false,
    };
    const dispose = this.#track(resource);
    if (this.#state === 'active') {
      try {
        this.#activate(resource);
      } catch (error) {
        this.#dispose(resource);
        throw error;
      }
    }
    return dispose;
  }

  /** Live resources by kind, what `inspect().plugins` reports. */
  counts(): Record<ResourceKind, number> {
    const counts: Record<ResourceKind, number> = {
      transform: 0,
      renderer: 0,
      subscription: 0,
      cleanup: 0,
    };
    for (const resource of this.#resources) counts[resource.kind] += 1;
    return counts;
  }

  /** Publish every staged resource at once after `init` succeeded. */
  commit(): void {
    if (this.#state !== 'staging') {
      throw new Error(`Plugin context for "${this.#pluginName}" cannot be committed`);
    }
    this.#state = 'committing';
    try {
      for (const resource of this.#resources) this.#activate(resource);
      this.#state = 'active';
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.#state === 'closed') return;
    this.#state = 'closed';
    for (const resource of [...this.#resources].reverse()) this.#dispose(resource);
    this.#resources.clear();
  }

  #track(resource: ScopedResource): PluginDisposer {
    this.#resources.add(resource);
    return (): void => {
      this.#dispose(resource);
    };
  }

  #activate(resource: ScopedResource): void {
    if (resource.disposed || resource.cleanup !== undefined || resource.acquire === undefined) {
      return;
    }
    const cleanup = resource.acquire();
    resource.cleanup = cleanup ?? noopDisposer;
  }

  #dispose(resource: ScopedResource): void {
    if (resource.disposed) return;
    resource.disposed = true;
    this.#resources.delete(resource);
    const cleanup = resource.cleanup;
    resource.cleanup = undefined;
    if (cleanup !== undefined) {
      try {
        // A `void` cleanup may still return a thenable; observe it without awaiting.
        const cleanupWithResult: () => unknown = cleanup;
        if (observeThenableResult(cleanupWithResult())) {
          this.#log(
            `plugin "${this.#pluginName}" cleanup returned a Promise/thenable; cleanups must be synchronous`,
          );
        }
      } catch (error) {
        this.#log(`plugin "${this.#pluginName}" cleanup failed:`, error);
      }
    }
    try {
      resource.finalize?.();
    } catch (error) {
      this.#log(`plugin "${this.#pluginName}" cleanup failed:`, error);
    }
  }
}
