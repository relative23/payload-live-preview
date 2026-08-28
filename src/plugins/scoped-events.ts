/**
 * Event facade handed to a plugin: subscriptions are owned by the plugin's
 * scope, emits go to the client's emitter. It implements the emitter surface
 * without extending it, so no unused base emitter is allocated per plugin.
 */

import type { EventEmitter } from '@events/emitter';
import type { EventHandler, LivePreviewEventMap, Unsubscribe } from '@events/types';
import { noopDisposer, type ResourceScope } from './resource-scope';
import type { PluginEvents } from './types';

interface OwnedSubscription {
  readonly kind: 'on' | 'once';
  readonly event: keyof LivePreviewEventMap;
  readonly handler: EventHandler<unknown>;
  dispose: Unsubscribe;
}

export class ScopedPluginEvents implements PluginEvents {
  readonly #events: EventEmitter;
  readonly #scope: ResourceScope;
  readonly #subscriptions = new Set<OwnedSubscription>();

  constructor(events: EventEmitter, scope: ResourceScope) {
    this.#events = events;
    this.#scope = scope;
  }

  on<E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): Unsubscribe {
    return this.#subscribe('on', event, handler);
  }

  once<E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): Unsubscribe {
    return this.#subscribe('once', event, handler);
  }

  off<E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): void {
    const untypedHandler = handler as EventHandler<unknown>;
    for (const subscription of [...this.#subscriptions]) {
      if (subscription.event === event && subscription.handler === untypedHandler) {
        subscription.dispose();
      }
    }
  }

  emit<E extends keyof LivePreviewEventMap>(
    event: E,
    payload: LivePreviewEventMap[E],
  ): Promise<void> {
    this.#scope.assertOpen();
    return this.#events.emit(event, payload);
  }

  emitWhile<E extends keyof LivePreviewEventMap>(
    event: E,
    payload: LivePreviewEventMap[E],
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    this.#scope.assertOpen();
    return this.#events.emitWhile(event, payload, () => {
      if (!this.#scope.eligible()) return false;
      const callerEligible = shouldContinue();
      // The predicate is plugin code and may close this scope re-entrantly.
      if (!this.#scope.eligible()) return false;
      return callerEligible;
    });
  }

  listenerCount(event: keyof LivePreviewEventMap): number {
    let count = 0;
    for (const subscription of this.#subscriptions) {
      if (subscription.event === event) count += 1;
    }
    return count;
  }

  removeAllListeners(event?: keyof LivePreviewEventMap): void {
    for (const subscription of [...this.#subscriptions]) {
      if (event === undefined || subscription.event === event) subscription.dispose();
    }
  }

  eventNames(): (keyof LivePreviewEventMap)[] {
    const names = new Set<keyof LivePreviewEventMap>();
    for (const subscription of this.#subscriptions) names.add(subscription.event);
    return [...names];
  }

  #subscribe<E extends keyof LivePreviewEventMap>(
    kind: 'on' | 'once',
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): Unsubscribe {
    this.#scope.assertOpen();

    const untypedHandler = handler as EventHandler<unknown>;
    const existing = [...this.#subscriptions].find(
      (subscription) =>
        subscription.kind === kind &&
        subscription.event === event &&
        subscription.handler === untypedHandler,
    );
    if (existing !== undefined) return existing.dispose;

    // A distinct wrapper per scope: two plugins passing the same handler
    // reference must be revocable independently in the Set-based emitter.
    let dispose = noopDisposer;
    let subscriptionActive = true;
    const wrapped: EventHandler<LivePreviewEventMap[E]> = async (payload) => {
      if (!this.#scope.active || !subscriptionActive) return;
      // Mirror the base emitter, which drops a once bucket before dispatch.
      if (kind === 'once') dispose();
      await handler(payload);
    };
    const subscription: OwnedSubscription = {
      kind,
      event,
      handler: untypedHandler,
      dispose: noopDisposer,
    };
    dispose = this.#scope.stage(
      'subscription',
      () => this.#events[kind](event, wrapped),
      () => {
        subscriptionActive = false;
        this.#subscriptions.delete(subscription);
      },
    );
    subscription.dispose = dispose;
    this.#subscriptions.add(subscription);
    return dispose;
  }
}
