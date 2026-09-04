import { describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { TRUSTED, deferred, flushMicrotasks, makeMessage } from './message-bus-harness';

describe('MessageBus — token validation ordering', () => {
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
  it('drops an untrusted unsettled queue head so it cannot block the locked origin', async () => {
    const first = deferred<boolean>();
    let lockedOrigin: string | undefined;
    const committed: string[] = [];
    const onInvalid = vi.fn();
    const bus = new MessageBus((origin) => lockedOrigin === undefined || origin === lockedOrigin, {
      onUpdate: (message, origin) => {
        lockedOrigin ??= origin;
        committed.push(String(message.data?.['id']));
      },
      onDocumentEvent: () => undefined,
      onInvalid,
      validateToken: (token) => {
        if (token === 'first') return first.promise;
        if (token === 'never') return new Promise<boolean>(() => undefined);
        return true;
      },
    });
    bus.attach();

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'first' },
        'https://admin-a.example.com',
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'never' },
        'https://admin-b.example.com',
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'C' }, previewToken: 'fast' },
        'https://admin-a.example.com',
      ),
    );

    first.resolve(true);
    await flushMicrotasks();

    expect(committed).toEqual(['A', 'C']);
    expect(onInvalid).toHaveBeenCalledWith('origin', 'https://admin-b.example.com');
    bus.detach();
  });
  it('fails closed when the origin matcher throws while draining an unsettled queue head', async () => {
    const first = deferred<boolean>();
    let lockedOrigin: string | undefined;
    const committed: string[] = [];
    const onInvalid = vi.fn();
    const bus = new MessageBus(
      (origin) => {
        if (lockedOrigin !== undefined && origin !== lockedOrigin) {
          throw new Error('dynamic origin policy failed');
        }
        return true;
      },
      {
        onUpdate: (message, origin) => {
          lockedOrigin ??= origin;
          committed.push(String(message.data?.['id']));
        },
        onDocumentEvent: () => undefined,
        onInvalid,
        validateToken: (token) => {
          if (token === 'first') return first.promise;
          if (token === 'never') return new Promise<boolean>(() => undefined);
          return true;
        },
      },
    );
    bus.attach();

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'first' },
        'https://admin-a.example.com',
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'never' },
        'https://admin-b.example.com',
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'C' }, previewToken: 'fast' },
        'https://admin-a.example.com',
      ),
    );

    first.resolve(true);
    await flushMicrotasks();

    expect(committed).toEqual(['A', 'C']);
    expect(onInvalid).toHaveBeenCalledWith('origin', 'https://admin-b.example.com');
    bus.detach();
  });
  it('continues draining when an update handler throws', async () => {
    const first = deferred<boolean>();
    const committed: string[] = [];
    const onUpdate = vi.fn((message: { data?: Record<string, unknown> }) => {
      const id = String(message.data?.['id']);
      committed.push(id);
      if (id === 'A') throw new Error('consumer failed');
    });
    const bus = new MessageBus(() => true, {
      onUpdate,
      onDocumentEvent: () => undefined,
      validateToken: (token) => (token === 'slow' ? first.promise : true),
    });
    bus.attach();
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'slow' },
        TRUSTED,
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'fast' },
        TRUSTED,
      ),
    );

    first.resolve(true);
    await flushMicrotasks();

    expect(committed).toEqual(['A', 'B']);
    bus.detach();
  });
  it('observes rejected update-handler thenables while continuing the ordered drain', async () => {
    const first = deferred<boolean>();
    const committed: string[] = [];
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async update handler failed'));
      },
    );
    const bus = new MessageBus(() => true, {
      onUpdate: (message) => {
        const id = String(message.data?.['id']);
        committed.push(id);
        if (id === 'A') return { then } as never;
      },
      onDocumentEvent: () => undefined,
      validateToken: (token) => (token === 'slow' ? first.promise : true),
    });
    bus.attach();
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'slow' },
        TRUSTED,
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'fast' },
        TRUSTED,
      ),
    );

    first.resolve(true);
    await flushMicrotasks();

    expect(committed).toEqual(['A', 'B']);
    expect(then).toHaveBeenCalledOnce();
    bus.detach();
  });
  it('fails closed without throwing for non-boolean synchronous validator results', async () => {
    type Validator = NonNullable<ConstructorParameters<typeof MessageBus>[1]['validateToken']>;
    const invalidValidators = [
      (() => 'true') as unknown as Validator,
      (() => ({ then: 42 })) as unknown as Validator,
    ];

    for (const validateToken of invalidValidators) {
      const onUpdate = vi.fn();
      const onInvalid = vi.fn();
      const bus = new MessageBus(() => true, {
        onUpdate,
        onDocumentEvent: () => undefined,
        onInvalid,
        validateToken,
      });
      bus.attach();

      expect(() => {
        window.dispatchEvent(
          makeMessage(
            { type: 'payload-live-preview', data: { id: 'rejected' }, previewToken: 'token' },
            TRUSTED,
          ),
        );
      }).not.toThrow();
      await flushMicrotasks();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(onInvalid).toHaveBeenCalledWith('token', TRUSTED);
      bus.detach();
    }
  });
  it('approves an asynchronous validator only when it fulfills with literal true', async () => {
    type Validator = NonNullable<ConstructorParameters<typeof MessageBus>[1]['validateToken']>;
    const validateToken = (() => Promise.resolve('true')) as unknown as Validator;
    const { bus, onUpdate, onInvalid } = withValidator(validateToken);

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'rejected' }, previewToken: 'token' },
        TRUSTED,
      ),
    );
    await flushMicrotasks();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('token', TRUSTED);
    bus.detach();
  });
  it('invalidates pending validation when its lifecycle generation is advanced', async () => {
    const verdict = deferred<boolean>();
    const { bus, onUpdate, onInvalid } = withValidator(() => verdict.promise);
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );
    bus.advanceGeneration();
    verdict.resolve(true);
    await flushMicrotasks();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).not.toHaveBeenCalled();
    bus.detach();
  });
  it('keeps the fresh queue usable when an origin recheck advances the generation', async () => {
    const oldVerdict = deferred<boolean>();
    const dispatched: string[] = [];
    let advanceDuringNextMatch = false;
    const bus = new MessageBus(
      () => {
        if (advanceDuringNextMatch) {
          advanceDuringNextMatch = false;
          bus.advanceGeneration();
        }
        return true;
      },
      {
        onUpdate: (message) => {
          dispatched.push(String(message.data?.['id']));
        },
        onDocumentEvent: () => undefined,
        validateToken: (token) => (token === 'old' ? oldVerdict.promise : true),
      },
    );
    bus.attach();
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );

    advanceDuringNextMatch = true;
    oldVerdict.resolve(true);
    await flushMicrotasks();
    expect(dispatched).toEqual([]);

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'new' }, previewToken: 'new' },
        TRUSTED,
      ),
    );
    expect(dispatched).toEqual(['new']);
    bus.detach();
  });
  it('does not let ingress matcher re-entry contaminate the fresh validation queue', async () => {
    const oldVerdict = deferred<boolean>();
    const validated: string[] = [];
    const dispatched: string[] = [];
    let advanceDuringNextIngress = false;
    const bus = new MessageBus(
      () => {
        if (advanceDuringNextIngress) {
          advanceDuringNextIngress = false;
          expect(bus.advanceGeneration()).toBe(true);
        }
        return true;
      },
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
    );
    bus.attach();

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'old' }, previewToken: 'old' },
        TRUSTED,
      ),
    );

    advanceDuringNextIngress = true;
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
});
