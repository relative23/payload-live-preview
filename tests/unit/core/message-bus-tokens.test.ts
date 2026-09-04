import { describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { TRUSTED, deferred, flushMicrotasks, makeMessage } from './message-bus-harness';

describe('MessageBus — token validation', () => {
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
  it('lets the ready handshake through even when a validator is set', () => {
    const { onUpdate } = withValidator(() => false);
    window.dispatchEvent(makeMessage({ type: 'payload-live-preview', ready: true }, TRUSTED));
    expect(onUpdate).toHaveBeenCalledOnce();
  });
  it('normalizes nullable optional fields before classifying a ready handshake', () => {
    const validateToken = vi.fn(() => false);
    const { bus, onUpdate, onInvalid } = withValidator(validateToken);
    const message = {
      type: 'payload-live-preview',
      ready: true,
      data: null,
      fieldSchemaJSON: null,
      globalSlug: null,
      collectionSlug: null,
      locale: null,
      previewToken: null,
      protocolVersion: null,
      externallyUpdatedRelationship: null,
      futureExtension: null,
    };

    window.dispatchEvent(makeMessage(message, TRUSTED));

    expect(validateToken).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(
      {
        type: 'payload-live-preview',
        ready: true,
        externallyUpdatedRelationship: null,
        futureExtension: null,
      },
      TRUSTED,
    );
    expect(onInvalid).not.toHaveBeenCalled();
    bus.detach();
  });
  it('approves a valid token and dispatches the update', () => {
    const { onUpdate, onInvalid } = withValidator((token) => token === 'ok');
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { x: 1 }, previewToken: 'ok' }, TRUSTED),
    );
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onInvalid).not.toHaveBeenCalled();
  });
  it('rejects messages without a token', () => {
    const { onUpdate, onInvalid } = withValidator((token) => token !== undefined);
    window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: { x: 1 } }, TRUSTED));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('token', TRUSTED);
  });
  it('rejects messages with an unapproved token', () => {
    const { onUpdate, onInvalid } = withValidator((token) => token === 'expected');
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { x: 1 }, previewToken: 'wrong' }, TRUSTED),
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('token', TRUSTED);
  });
  it('supports async validators', async () => {
    const { onUpdate, onInvalid } = withValidator((token) => Promise.resolve(token === 'ok'));
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { x: 1 }, previewToken: 'ok' }, TRUSTED),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onInvalid).not.toHaveBeenCalled();
  });
  it('treats async rejection as token failure', async () => {
    const { onUpdate, onInvalid } = withValidator(() => Promise.reject(new Error('verify failed')));
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { x: 1 }, previewToken: 't' }, TRUSTED),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('token', TRUSTED);
  });
  it('treats sync validator throwing as token failure', () => {
    const { onUpdate, onInvalid } = withValidator(() => {
      throw new Error('boom');
    });
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { x: 1 }, previewToken: 't' }, TRUSTED),
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('token', TRUSTED);
  });
  it('serialises async validations in arrival order (no race)', async () => {
    // Message A arrives first but its validation resolves LATER than B's.
    // Without serialisation, B would dispatch before A. The chain must
    // preserve arrival order: A dispatched before B.
    const dispatched: string[] = [];
    const resolvers: Record<string, (ok: boolean) => void> = {};
    const bus = new MessageBus((o) => o === TRUSTED, {
      onUpdate: (msg) => {
        dispatched.push((msg.data as { id: string }).id);
      },
      onDocumentEvent: () => {},
      onInvalid: () => {},
      validateToken: (token) =>
        new Promise<boolean>((resolve) => {
          resolvers[token!] = resolve;
        }),
    });
    bus.attach();

    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'A' }, TRUSTED),
    );
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'B' }, TRUSTED),
    );

    // Resolve B FIRST — the out-of-order completion the bug depends on.
    resolvers['B']!(true);
    await new Promise((r) => setTimeout(r, 5));
    // Nothing dispatched yet: the chain is still waiting on A.
    expect(dispatched).toEqual([]);

    resolvers['A']!(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(dispatched).toEqual(['A', 'B']);

    bus.detach();
  });
  it('serialises a synchronous verdict behind a pending async verdict', async () => {
    const first = deferred<boolean>();
    const dispatched: string[] = [];
    const onUpdate = vi.fn((message: { data?: Record<string, unknown> }) => {
      dispatched.push(String(message.data?.['id']));
    });
    const orderedBus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onDocumentEvent: () => {},
      validateToken: (token) => (token === 'A' ? first.promise : true),
    });
    orderedBus.attach();

    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'A' }, TRUSTED),
    );
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'B' }, TRUSTED),
    );
    await flushMicrotasks();
    expect(dispatched).toEqual([]);

    first.resolve(true);
    await flushMicrotasks();
    expect(dispatched).toEqual(['A', 'B']);
    orderedBus.detach();
  });
  it('drains a large settled backlog in order without shifting the queue', async () => {
    const backlogSize = 10_000;
    const verdicts: {
      readonly promise: Promise<boolean>;
      readonly resolve: (value: boolean) => void;
    }[] = [];
    const dispatched: number[] = [];
    let acceptSynchronously = false;
    const orderedBus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate: (message) => {
        dispatched.push(Number(message.data?.['sequence']));
      },
      onDocumentEvent: () => undefined,
      validateToken: () => {
        if (acceptSynchronously) return true;
        const verdict = deferred<boolean>();
        verdicts.push(verdict);
        return verdict.promise;
      },
    });
    orderedBus.attach();

    for (let sequence = 0; sequence < backlogSize; sequence += 1) {
      window.dispatchEvent(
        makeMessage({ type: 'payload-live-preview', data: { sequence } }, TRUSTED),
      );
    }
    expect(dispatched).toEqual([]);

    const originalShift = Array.prototype.shift;
    let validationQueueShiftCalls = 0;
    Array.prototype.shift = function countingShift<T>(this: T[]): T | undefined {
      const candidate: unknown = this[0];
      if (typeof candidate === 'object' && candidate !== null) {
        const message: unknown = Reflect.get(candidate, 'message');
        if (typeof message === 'object' && message !== null) {
          const data: unknown = Reflect.get(message, 'data');
          if (
            typeof data === 'object' &&
            data !== null &&
            typeof Reflect.get(data, 'sequence') === 'number'
          ) {
            validationQueueShiftCalls += 1;
          }
        }
      }
      return originalShift.call(this) as T | undefined;
    };
    try {
      for (const verdict of verdicts) verdict.resolve(true);
      await flushMicrotasks();
    } finally {
      Array.prototype.shift = originalShift;
    }

    expect(validationQueueShiftCalls).toBe(0);
    expect(dispatched).toHaveLength(backlogSize);
    for (let sequence = 0; sequence < backlogSize; sequence += 1) {
      if (dispatched[sequence] !== sequence) {
        throw new Error(`backlog dispatch order diverged at sequence ${String(sequence)}`);
      }
    }

    // A new synchronous verdict dispatches immediately once the backlog is
    // empty; no stale head or generation state remains behind.
    acceptSynchronously = true;
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { sequence: backlogSize } }, TRUSTED),
    );
    expect(dispatched.at(-1)).toBe(backlogSize);
    orderedBus.detach();
  });
  it('commits a synchronous rejection behind an older async approval', async () => {
    const first = deferred<boolean>();
    const committed: string[] = [];
    const orderedBus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate: (message) => {
        committed.push(`update:${String(message.data?.['id'])}`);
      },
      onDocumentEvent: () => {},
      onInvalid: (reason) => {
        committed.push(`invalid:${reason}`);
      },
      validateToken: (token) => (token === 'A' ? first.promise : false),
    });
    orderedBus.attach();

    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'A' }, TRUSTED),
    );
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'B' }, TRUSTED),
    );
    await flushMicrotasks();
    expect(committed).toEqual([]);

    first.resolve(true);
    await flushMicrotasks();
    expect(committed).toEqual(['update:A', 'invalid:token']);
    orderedBus.detach();
  });
  it('commits a synchronous approval behind an older async rejection', async () => {
    const first = deferred<boolean>();
    const committed: string[] = [];
    const orderedBus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate: (message) => {
        committed.push(`update:${String(message.data?.['id'])}`);
      },
      onDocumentEvent: () => undefined,
      onInvalid: (reason) => {
        committed.push(`invalid:${reason}`);
      },
      validateToken: (token) => (token === 'A' ? first.promise : true),
    });
    orderedBus.attach();

    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'A' }, TRUSTED),
    );
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'B' }, TRUSTED),
    );
    await flushMicrotasks();
    expect(committed).toEqual([]);

    first.resolve(false);
    await flushMicrotasks();
    expect(committed).toEqual(['invalid:token', 'update:B']);
    orderedBus.detach();
  });
  it('assigns revisions before validation so rejected updates leave gaps', () => {
    const { bus, onUpdate } = withValidator((token) => token !== 'reject');
    const first = {
      type: 'payload-live-preview' as const,
      data: { id: 'first' },
      previewToken: 'accept',
    };
    const rejected = {
      type: 'payload-live-preview' as const,
      data: { id: 'rejected' },
      previewToken: 'reject',
    };
    const third = {
      type: 'payload-live-preview' as const,
      data: { id: 'third' },
      previewToken: 'accept',
    };

    window.dispatchEvent(makeMessage(first, TRUSTED));
    window.dispatchEvent(makeMessage(rejected, TRUSTED));
    window.dispatchEvent(makeMessage(third, TRUSTED));

    expect(onUpdate).toHaveBeenNthCalledWith(1, first, TRUSTED, {
      generation: 1,
      revision: 1,
    });
    expect(onUpdate).toHaveBeenNthCalledWith(2, third, TRUSTED, {
      generation: 1,
      revision: 3,
    });
    bus.detach();
  });
  it('re-checks the current origin policy before committing an async token verdict', async () => {
    const verdict = deferred<boolean>();
    let lockedOrigin: string | undefined;
    const onUpdate = vi.fn((_message, origin: string) => {
      lockedOrigin ??= origin;
    });
    const onInvalid = vi.fn();
    const bus = new MessageBus((origin) => lockedOrigin === undefined || origin === lockedOrigin, {
      onUpdate,
      onDocumentEvent: () => undefined,
      onInvalid,
      validateToken: (token) => (token === 'slow' ? verdict.promise : true),
    });
    bus.attach();

    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'A' }, previewToken: 'slow' },
        'https://admin-a.example.com',
      ),
    );
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { id: 'B' }, previewToken: 'fast' },
        'https://admin-b.example.com',
      ),
    );
    verdict.resolve(true);
    await flushMicrotasks();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[1]).toBe('https://admin-a.example.com');
    expect(onInvalid).toHaveBeenCalledWith('origin', 'https://admin-b.example.com');
    bus.detach();
  });
});
