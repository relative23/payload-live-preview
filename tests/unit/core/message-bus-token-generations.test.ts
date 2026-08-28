import { describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { TRUSTED, deferred, flushMicrotasks, makeMessage } from './message-bus-harness';

describe('MessageBus — token validation across generations', () => {
  function withValidator(
    validator: (token: string | undefined, origin: string) => boolean | Promise<boolean>,
  ): {
    bus: MessageBus;
    onUpdate: ReturnType<typeof vi.fn>;
    onInvalid: ReturnType<typeof vi.fn>;
  } {
    const onUpdate = vi.fn();
    const onInvalid = vi.fn();
    const bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onDocumentEvent: () => {},
      onInvalid,
      validateToken: validator,
    });
    bus.attach();
    return { bus, onUpdate, onInvalid };
  }
  it('does not let validator lookup re-entry contaminate the fresh validation queue', async () => {
    const oldVerdict = deferred<boolean>();
    const validated: string[] = [];
    const dispatched: string[] = [];
    let advanceDuringNextLookup = false;
    const handlers: ConstructorParameters<typeof MessageBus>[1] = new Proxy(
      {
        onUpdate: (message) => {
          dispatched.push(String(message.data?.['id']));
        },
        onDocumentEvent: () => undefined,
        validateToken: (token) => {
          const value = String(token);
          validated.push(value);
          return value === 'old' ? oldVerdict.promise : true;
        },
      },
      {
        get(target, property, receiver) {
          if (property === 'validateToken' && advanceDuringNextLookup) {
            advanceDuringNextLookup = false;
            expect(bus.advanceGeneration()).toBe(true);
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        },
      },
    );
    const bus = new MessageBus(() => true, handlers);
    bus.attach();

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );

    advanceDuringNextLookup = true;
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'stale' }, previewToken: 'stale' },
        TRUSTED,
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'fresh' }, previewToken: 'fresh' },
        TRUSTED,
      ),
    );

    expect(validated).toEqual(['old', 'fresh']);
    expect(dispatched).toEqual(['fresh']);

    oldVerdict.resolve(true);
    await flushMicrotasks();
    expect(dispatched).toEqual(['fresh']);
    bus.detach();
  });
  it('does not let validator callback re-entry contaminate the fresh validation queue', async () => {
    const oldVerdict = deferred<boolean>();
    const validated: string[] = [];
    const dispatched: string[] = [];
    const bus = new MessageBus(() => true, {
      onUpdate: (message) => {
        dispatched.push(String(message.data?.['id']));
      },
      onDocumentEvent: () => undefined,
      validateToken: (token) => {
        const value = String(token);
        validated.push(value);
        if (value === 'old') return oldVerdict.promise;
        if (value === 'stale') {
          expect(bus.advanceGeneration()).toBe(true);
          window.dispatchEvent(
            makeMessage(
              { type: 'payload-live-preview', data: { id: 'fresh' }, previewToken: 'fresh' },
              TRUSTED,
            ),
          );
        }
        return true;
      },
    });
    bus.attach();

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'stale' }, previewToken: 'stale' },
        TRUSTED,
      ),
    );

    expect(validated).toEqual(['old', 'stale', 'fresh']);
    expect(dispatched).toEqual(['fresh']);

    oldVerdict.resolve(true);
    await flushMicrotasks();
    expect(dispatched).toEqual(['fresh']);
    bus.detach();
  });
  it('does not let thenable assimilation re-entry contaminate the fresh validation queue', async () => {
    type Validator = NonNullable<ConstructorParameters<typeof MessageBus>[1]['validateToken']>;
    const oldVerdict = deferred<boolean>();
    const dispatched: string[] = [];
    const staleThenable = Object.defineProperty({}, 'then', {
      get() {
        expect(bus.advanceGeneration()).toBe(true);
        window.dispatchEvent(
          makeMessage(
            { type: 'payload-live-preview', data: { id: 'fresh' }, previewToken: 'fresh' },
            TRUSTED,
          ),
        );
        return (resolve: (approved: boolean) => void): void => {
          resolve(true);
        };
      },
    }) as Promise<boolean>;
    const validateToken = ((token: string | undefined) => {
      if (token === 'old') return oldVerdict.promise;
      if (token === 'stale') return staleThenable;
      return true;
    }) satisfies Validator;
    const bus = new MessageBus(() => true, {
      onUpdate: (message) => {
        dispatched.push(String(message.data?.['id']));
      },
      onDocumentEvent: () => undefined,
      validateToken,
    });
    bus.attach();

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'stale' }, previewToken: 'stale' },
        TRUSTED,
      ),
    );

    expect(dispatched).toEqual(['fresh']);
    oldVerdict.resolve(true);
    await flushMicrotasks();
    expect(dispatched).toEqual(['fresh']);
    bus.detach();
  });
  it('discards a pending async verdict after detach', async () => {
    const verdict = deferred<boolean>();
    const { bus, onUpdate, onInvalid } = withValidator(() => verdict.promise);
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );
    bus.detach();
    verdict.resolve(true);
    await flushMicrotasks();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).not.toHaveBeenCalled();
  });
  it('starts a fresh validation queue after detach and reattach', async () => {
    const oldVerdict = deferred<boolean>();
    const dispatched: string[] = [];
    const bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate: (message) => {
        dispatched.push(String(message.data?.['id']));
      },
      onDocumentEvent: () => {},
      validateToken: (token) => (token === 'old' ? oldVerdict.promise : Promise.resolve(true)),
    });
    bus.attach();
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );
    bus.detach();
    bus.attach();
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'new' }, previewToken: 'new' },
        TRUSTED,
      ),
    );
    await flushMicrotasks();
    expect(dispatched).toEqual(['new']);

    oldVerdict.resolve(true);
    await flushMicrotasks();
    expect(dispatched).toEqual(['new']);
    bus.detach();
  });
});
