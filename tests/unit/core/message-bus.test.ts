import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { buildSchemaIndex } from '@schema/walker';

const TRUSTED = 'https://admin.example.com';
const UNTRUSTED = 'https://evil.example.com';

function makeMessage(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('MessageBus — receive', () => {
  type BusHandlers = ConstructorParameters<typeof MessageBus>[1];
  let onUpdate: ReturnType<typeof vi.fn<BusHandlers['onUpdate']>>;
  let onDocumentEvent: ReturnType<typeof vi.fn<BusHandlers['onDocumentEvent']>>;
  let onInvalid: ReturnType<typeof vi.fn<NonNullable<BusHandlers['onInvalid']>>>;
  let bus: MessageBus;

  beforeEach(() => {
    onUpdate = vi.fn<BusHandlers['onUpdate']>();
    onDocumentEvent = vi.fn<BusHandlers['onDocumentEvent']>();
    onInvalid = vi.fn<NonNullable<BusHandlers['onInvalid']>>();
    bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onDocumentEvent,
      onInvalid,
    });
    bus.attach();
  });

  afterEach(() => {
    bus.detach();
  });

  it('rejects untrusted origins', () => {
    window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: { x: 1 } }, UNTRUSTED));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('origin', UNTRUSTED);
  });

  it('fails closed when the origin matcher throws', () => {
    bus.detach();
    const throwingMatcher = vi.fn(() => {
      throw new Error('matcher failed');
    });
    bus = new MessageBus(throwingMatcher, { onUpdate, onDocumentEvent, onInvalid });
    bus.attach();

    expect(() => {
      window.dispatchEvent(
        makeMessage({ type: 'payload-live-preview', data: { title: 'blocked' } }, TRUSTED),
      );
    }).not.toThrow();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('origin', TRUSTED);
  });

  it('rejects a non-string type as a shape fault, not as an unknown type', () => {
    window.dispatchEvent(makeMessage({ type: 42, data: { x: 1 } }, TRUSTED));

    expect(onUpdate).not.toHaveBeenCalled();
    // Accepting the object and letting the type switch miss would report
    // `type` instead — the payload never was a well-formed message.
    expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
  });

  it('rejects non-object payloads', () => {
    window.dispatchEvent(makeMessage('hello', TRUSTED));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
  });

  it('rejects messages without a type string', () => {
    window.dispatchEvent(makeMessage({ data: { x: 1 } }, TRUSTED));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
  });

  it('rejects a payload-live-preview message whose data is not an object', () => {
    // Regression: the shallow guard used to let non-object `data`
    // through, contradicting `data?: Record<string, unknown>`.
    for (const badData of ['not an object', 42, true, ['a']]) {
      onUpdate.mockClear();
      onInvalid.mockClear();
      window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: badData }, TRUSTED));
      expect(onUpdate).not.toHaveBeenCalled();
      expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
    }
  });

  it('rejects non-plain object update data', () => {
    for (const badData of [new Date('2026-08-13T00:00:00.000Z'), new Map([['title', 'blocked']])]) {
      onUpdate.mockClear();
      onInvalid.mockClear();
      window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: badData }, TRUSTED));
      expect(onUpdate).not.toHaveBeenCalled();
      expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
    }
  });

  it('accepts local, null-prototype, and cross-realm plain object update data', () => {
    const localData = { title: 'local' };
    const nullPrototypeData = Object.assign(Object.create(null) as Record<string, unknown>, {
      title: 'null-prototype',
    });
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameWindow = frame.contentWindow;
    if (frameWindow === null) throw new Error('iframe has no contentWindow');
    const realmGlobal = frameWindow as unknown as typeof globalThis;
    const crossRealmData: unknown = realmGlobal.JSON.parse('{"title":"cross-realm"}');

    try {
      for (const data of [localData, nullPrototypeData, crossRealmData]) {
        window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data }, TRUSTED));
      }
    } finally {
      frame.remove();
    }

    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(onUpdate.mock.calls.map(([message]) => message.data)).toEqual([
      localData,
      nullPrototypeData,
      crossRealmData,
    ]);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('rejects every wrongly-typed optional payload-live-preview field', () => {
    const malformedFields: readonly (readonly [string, unknown])[] = [
      ['fieldSchemaJSON', {}],
      ['globalSlug', 42],
      ['collectionSlug', 42],
      ['locale', 123],
      ['ready', 'yes'],
      ['previewToken', 42],
      ['protocolVersion', '1'],
    ];

    for (const [field, value] of malformedFields) {
      onUpdate.mockClear();
      onInvalid.mockClear();
      window.dispatchEvent(
        makeMessage({ type: 'payload-live-preview', data: {}, [field]: value }, TRUSTED),
      );
      expect(onUpdate, field).not.toHaveBeenCalled();
      expect(onInvalid, field).toHaveBeenCalledWith('shape', TRUSTED);
    }
  });

  it('accepts a well-formed message with an object data and correct scalars', () => {
    const msg = { type: 'payload-live-preview' as const, data: { title: 'x' }, locale: 'de' };
    window.dispatchEvent(makeMessage(msg, TRUSTED));
    expect(onUpdate).toHaveBeenCalledWith(msg, TRUSTED, { generation: 1, revision: 1 });
  });

  it('treats null optional scalars as absent (real global sends collectionSlug undefined/null)', () => {
    // A global's message carries collectionSlug: undefined; a JSON round-trip
    // turns that into null. Both must be accepted, not dropped as malformed.
    const msg = {
      type: 'payload-live-preview' as const,
      data: { title: 'x' },
      globalSlug: 'homepage',
      collectionSlug: null,
      locale: 'de',
      externallyUpdatedRelationship: null,
    };
    window.dispatchEvent(makeMessage(msg, TRUSTED));
    expect(onUpdate).toHaveBeenCalledWith(
      {
        type: 'payload-live-preview',
        data: { title: 'x' },
        globalSlug: 'homepage',
        locale: 'de',
        externallyUpdatedRelationship: null,
      },
      TRUSTED,
      { generation: 1, revision: 1 },
    );
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('routes payload-live-preview messages to onUpdate', () => {
    const message = { type: 'payload-live-preview' as const, data: { title: 'x' } };
    window.dispatchEvent(makeMessage(message, TRUSTED));
    expect(onUpdate).toHaveBeenCalledWith(message, TRUSTED, { generation: 1, revision: 1 });
  });

  it('normalizes malformed schema entries before exposing a message downstream', () => {
    const message = {
      type: 'payload-live-preview' as const,
      data: { title: 'safe' },
      fieldSchemaJSON: [
        null,
        { name: '', type: 'text' },
        { name: 'missingType' },
        {
          name: 'hero',
          type: 'group',
          fields: [false, { name: 'title', type: 'text' }],
        },
      ],
    };

    expect(() => {
      window.dispatchEvent(makeMessage(message, TRUSTED));
    }).not.toThrow();

    const normalized = onUpdate.mock.calls[0]?.[0];
    expect(normalized?.fieldSchemaJSON).toEqual([
      {
        name: 'hero',
        type: 'group',
        fields: [{ name: 'title', type: 'text' }],
      },
    ]);
    expect(() => {
      buildSchemaIndex(normalized?.fieldSchemaJSON ?? []);
    }).not.toThrow();
  });

  it('contains exceptions from hostile nested schema accessors', () => {
    const hostileSchemaEntry = Object.defineProperty({}, 'name', {
      enumerable: true,
      get() {
        throw new Error('hostile schema getter');
      },
    });
    const message = {
      type: 'payload-live-preview' as const,
      data: { title: 'safe' },
      fieldSchemaJSON: [hostileSchemaEntry],
    };

    expect(() => {
      window.dispatchEvent(makeMessage(message, TRUSTED));
    }).not.toThrow();

    expect(onUpdate).toHaveBeenCalledWith({ ...message, fieldSchemaJSON: [] }, TRUSTED, {
      generation: 1,
      revision: 1,
    });
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('routes payload-document-event messages to onDocumentEvent', () => {
    const message = { type: 'payload-document-event' as const, action: 'updated' as const };
    window.dispatchEvent(makeMessage(message, TRUSTED));
    expect(onDocumentEvent).toHaveBeenCalledWith(message, TRUSTED);
  });

  it('accepts every documented payload-document-event field together', () => {
    const message = {
      type: 'payload-document-event' as const,
      action: 'updated' as const,
      slug: 'posts',
      id: 42,
    };

    window.dispatchEvent(makeMessage(message, TRUSTED));

    expect(onDocumentEvent).toHaveBeenCalledWith(message, TRUSTED);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('isolates a throwing document-event handler and keeps listening', () => {
    onDocumentEvent.mockImplementationOnce(() => {
      throw new Error('document handler failed');
    });

    expect(() => {
      window.dispatchEvent(makeMessage({ type: 'payload-document-event' }, TRUSTED));
    }).not.toThrow();
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'still-live' } }, TRUSTED),
    );

    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('contains a hostile thenable returned by a document-event handler', () => {
    let thenReads = 0;
    const hostile = Object.defineProperty({}, 'then', {
      get() {
        thenReads += 1;
        throw new Error('hostile document handler then getter');
      },
    });
    onDocumentEvent.mockImplementationOnce(() => hostile as never);

    expect(() => {
      window.dispatchEvent(makeMessage({ type: 'payload-document-event' }, TRUSTED));
    }).not.toThrow();
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'still-live' } }, TRUSTED),
    );

    expect(thenReads).toBe(1);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("accepts Payload's bare payload-document-event message", () => {
    const message = { type: 'payload-document-event' as const };
    window.dispatchEvent(makeMessage(message, TRUSTED));
    expect(onDocumentEvent).toHaveBeenCalledWith(message, TRUSTED);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('rejects malformed payload-document-event fields', () => {
    const malformed = [
      { type: 'payload-document-event', action: 'renamed' },
      { type: 'payload-document-event', action: null },
      { type: 'payload-document-event', slug: 42 },
      { type: 'payload-document-event', slug: null },
      { type: 'payload-document-event', id: { nested: true } },
      { type: 'payload-document-event', id: Number.NaN },
      { type: 'payload-document-event', id: null },
    ];
    for (const message of malformed) {
      onDocumentEvent.mockClear();
      onInvalid.mockClear();
      window.dispatchEvent(makeMessage(message, TRUSTED));
      expect(onDocumentEvent).not.toHaveBeenCalled();
      expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
    }
  });

  it('tolerates unknown fields on a valid document event for protocol evolution', () => {
    const message = { type: 'payload-document-event' as const, futureField: { version: 2 } };
    window.dispatchEvent(makeMessage(message, TRUSTED));
    expect(onDocumentEvent).toHaveBeenCalledWith(message, TRUSTED);
  });

  it('reports unknown types via onInvalid', () => {
    window.dispatchEvent(makeMessage({ type: 'mystery' }, TRUSTED));
    expect(onInvalid).toHaveBeenCalledWith('type', TRUSTED);
  });

  it('isolates a throwing invalid-message handler and keeps listening', () => {
    onInvalid.mockImplementationOnce(() => {
      throw new Error('invalid handler failed');
    });

    expect(() => {
      window.dispatchEvent(makeMessage({ type: 'unknown' }, TRUSTED));
    }).not.toThrow();
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'still-live' } }, TRUSTED),
    );

    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('observes a rejected thenable returned by an invalid-message handler', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async invalid handler failed'));
      },
    );
    onInvalid.mockImplementationOnce(() => ({ then }) as never);

    window.dispatchEvent(makeMessage({ type: 'unknown' }, TRUSTED));
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'still-live' } }, TRUSTED),
    );
    await flushMicrotasks();

    expect(then).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('contains unexpected property-access errors at the listener boundary', () => {
    const malformed = Object.defineProperty({}, 'type', {
      get() {
        throw new Error('hostile getter');
      },
    });

    expect(() => {
      window.dispatchEvent(makeMessage(malformed, TRUSTED));
    }).not.toThrow();
    expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
  });

  it('contains hostile MessageEvent origin and data accessors at the listener boundary', () => {
    const hostileOrigin = new Event('message');
    Object.defineProperties(hostileOrigin, {
      origin: {
        get() {
          throw new Error('hostile origin getter');
        },
      },
      data: { value: { type: 'payload-live-preview', data: { title: 'blocked' } } },
    });
    const hostileData = new Event('message');
    Object.defineProperties(hostileData, {
      origin: { value: TRUSTED },
      data: {
        get() {
          throw new Error('hostile data getter');
        },
      },
    });

    expect(() => {
      window.dispatchEvent(hostileOrigin);
      window.dispatchEvent(hostileData);
    }).not.toThrow();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenNthCalledWith(1, 'shape', '');
    expect(onInvalid).toHaveBeenNthCalledWith(2, 'shape', TRUSTED);
  });

  it('contains hostile optional payload accessors and keeps listening', () => {
    const malformed = {
      type: 'payload-live-preview',
      data: { title: 'blocked' },
      get locale(): string {
        throw new Error('hostile locale getter');
      },
    };

    expect(() => {
      window.dispatchEvent(makeMessage(malformed, TRUSTED));
    }).not.toThrow();
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'still-live' } }, TRUSTED),
    );

    expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('discards stale ingress after generation changes at proxy-capable boundaries', () => {
    const advanceOnce = (): (() => void) => {
      let advanced = false;
      return () => {
        if (advanced) return;
        advanced = true;
        bus.advanceGeneration();
      };
    };
    const cases: readonly (readonly [string, () => Event])[] = [
      [
        'MessageEvent origin getter',
        () => {
          const advance = advanceOnce();
          const event = new Event('message');
          Object.defineProperties(event, {
            origin: {
              get() {
                advance();
                return TRUSTED;
              },
            },
            data: {
              value: { type: 'payload-live-preview', data: { id: 'stale' } },
            },
          });
          return event;
        },
      ],
      [
        'MessageEvent data getter',
        () => {
          const advance = advanceOnce();
          const event = new Event('message');
          Object.defineProperties(event, {
            origin: { value: TRUSTED },
            data: {
              get() {
                advance();
                return { type: 'payload-live-preview', data: { id: 'stale' } };
              },
            },
          });
          return event;
        },
      ],
      [
        'message type getter',
        () => {
          const advance = advanceOnce();
          const message = Object.defineProperty({ data: { id: 'stale' } }, 'type', {
            enumerable: true,
            get() {
              advance();
              return 'payload-live-preview';
            },
          });
          return makeMessage(message, TRUSTED);
        },
      ],
      [
        'message shape getter',
        () => {
          const advance = advanceOnce();
          const message = {
            type: 'payload-live-preview',
            data: { id: 'stale' },
            get locale(): string {
              advance();
              return 'en';
            },
          };
          return makeMessage(message, TRUSTED);
        },
      ],
      [
        'revision data prototype trap',
        () => {
          const advance = advanceOnce();
          let prototypeReads = 0;
          const data = new Proxy(
            { id: 'stale' },
            {
              getPrototypeOf(target) {
                prototypeReads += 1;
                if (prototypeReads === 2) advance();
                return Reflect.getPrototypeOf(target);
              },
            },
          );
          return makeMessage({ type: 'payload-live-preview', data }, TRUSTED);
        },
      ],
      [
        'message normalization getter',
        () => {
          const advance = advanceOnce();
          const message = { type: 'payload-live-preview', data: { id: 'stale' } };
          Object.defineProperty(message, 'futureExtension', {
            enumerable: true,
            get() {
              advance();
              return 'stale';
            },
          });
          return makeMessage(message, TRUSTED);
        },
      ],
      [
        'nested schema parser getter',
        () => {
          const advance = advanceOnce();
          const schemaEntry = Object.defineProperty({ type: 'text' }, 'name', {
            enumerable: true,
            get() {
              advance();
              return 'title';
            },
          });
          return makeMessage(
            {
              type: 'payload-live-preview',
              data: { id: 'stale' },
              fieldSchemaJSON: [schemaEntry],
            },
            TRUSTED,
          );
        },
      ],
    ];

    for (const [boundary, makeStaleEvent] of cases) {
      onUpdate.mockClear();
      onInvalid.mockClear();
      window.dispatchEvent(makeStaleEvent());
      window.dispatchEvent(
        makeMessage({ type: 'payload-live-preview', data: { id: 'fresh' } }, TRUSTED),
      );

      expect(onUpdate, boundary).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls[0]?.[0].data, boundary).toEqual({ id: 'fresh' });
      expect(onInvalid, boundary).not.toHaveBeenCalled();
    }
  });

  it('leaves the revision untouched when the generation advances during the shape check', () => {
    // The recheck between `isPlainObject(data)` and the revision allocation is
    // invisible in the callbacks: with it removed a later recheck still stops
    // the stale message, so `onUpdate` looks identical either way. What differs
    // is the counter — a stale message that gets past this point consumes a
    // revision the next update then skips. Asserting callbacks alone left this
    // guard's `false` mutant alive, and which CI run happened to kill it was a
    // matter of timing.
    // Two prototype reads happen per message: the shape check on the way in,
    // and `isPlainObject` inside the dispatch. Advancing on the first is caught
    // by the entry recheck, so it says nothing about this one — the advance has
    // to land on the second.
    let reads = 0;
    const data = new Proxy(
      { id: 'stale' },
      {
        getPrototypeOf(target) {
          reads += 1;
          if (reads === 2) expect(bus.advanceGeneration()).toBe(true);
          return Reflect.getPrototypeOf(target);
        },
      },
    );

    window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data }, TRUSTED));
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { id: 'fresh' } }, TRUSTED),
    );

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0].data).toEqual({ id: 'fresh' });
    expect(onUpdate.mock.calls[0]?.[2]).toEqual({ generation: 2, revision: 1 });
  });

  it('rechecks generation after proxy handler lookup before invoking callbacks', () => {
    type HandlerName = 'onUpdate' | 'onDocumentEvent' | 'onInvalid';
    const cases: readonly (readonly [HandlerName, unknown, string])[] = [
      ['onUpdate', { type: 'payload-live-preview', data: { id: 'update' } }, 'update'],
      ['onDocumentEvent', { type: 'payload-document-event' }, 'document'],
      ['onInvalid', { type: 'unknown' }, 'invalid'],
    ];

    for (const [boundary, message, expectedCall] of cases) {
      bus.detach();
      const calls: string[] = [];
      let advanceDuringNextLookup = true;
      const handlers: ConstructorParameters<typeof MessageBus>[1] = new Proxy(
        {
          onUpdate: () => {
            calls.push('update');
          },
          onDocumentEvent: () => {
            calls.push('document');
          },
          onInvalid: () => {
            calls.push('invalid');
          },
        },
        {
          get(target, property, receiver) {
            if (property === boundary && advanceDuringNextLookup) {
              advanceDuringNextLookup = false;
              guardedBus.advanceGeneration();
            }
            const value: unknown = Reflect.get(target, property, receiver);
            return value;
          },
        },
      );
      const guardedBus = new MessageBus(() => true, handlers);
      bus = guardedBus;
      bus.attach();

      window.dispatchEvent(makeMessage(message, TRUSTED));
      window.dispatchEvent(makeMessage(message, TRUSTED));

      expect(calls, boundary).toEqual([expectedCall]);
    }
  });

  it('detach removes the listener', () => {
    bus.detach();
    window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('attach is idempotent', () => {
    bus.attach();
    bus.attach();
    window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('detach is idempotent', () => {
    bus.detach();
    expect(() => {
      bus.detach();
    }).not.toThrow();
  });

  it('detach removes the listener from the target used by attach', () => {
    bus.detach();
    const target = new EventTarget() as unknown as Window;
    bus.attach(target);
    bus.detach();
    target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('rolls back a listener when addEventListener registers it and then throws', () => {
    bus.detach();
    const target = new EventTarget();
    const nativeAdd = target.addEventListener.bind(target);
    const nativeRemove = target.removeEventListener.bind(target);
    const remove = vi.fn(nativeRemove);
    const failure = new Error('add failed after registration');
    Object.defineProperties(target, {
      addEventListener: {
        value: (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          nativeAdd(type, listener, options);
          throw failure;
        },
      },
      removeEventListener: { value: remove },
    });

    expect(() => {
      bus.attach(target as unknown as Window);
    }).toThrow(failure);
    target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));

    expect(remove).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps a newer same-target attachment created reentrantly by addEventListener', () => {
    bus.detach();
    const target = new EventTarget();
    const windowTarget = target as unknown as Window;
    const nativeAdd = target.addEventListener.bind(target);
    const nativeRemove = target.removeEventListener.bind(target);
    let reenter = true;
    Object.defineProperties(target, {
      addEventListener: {
        value: (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          nativeAdd(type, listener, options);
          if (reenter) {
            reenter = false;
            bus.detach();
            bus.attach(windowTarget);
          }
        },
      },
      removeEventListener: { value: nativeRemove },
    });

    bus.attach(windowTarget);
    target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));

    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('does not consult the origin matcher for a superseded generation', () => {
    // `#matchesOrigin` rechecks the generation on entry and again around the
    // matcher's verdict. Removing the entry check does not change the verdict —
    // the second one still refuses — so callbacks look identical. What changes
    // is that a consumer-supplied matcher is invoked on behalf of an attachment
    // that no longer exists, which is exactly what a trust boundary must not do.
    bus.detach();
    const seen: string[] = [];
    const scoped = new MessageBus((origin) => {
      seen.push(origin);
      return origin === TRUSTED;
    }, { onUpdate, onDocumentEvent: () => undefined });
    scoped.attach();

    const event = new Event('message');
    Object.defineProperties(event, {
      origin: {
        get(): string {
          // Reading the origin is the last host boundary before the check.
          scoped.advanceGeneration();
          return TRUSTED;
        },
      },
      data: { value: { type: 'payload-live-preview', data: { id: 'stale' } } },
    });
    window.dispatchEvent(event);

    expect(seen).toEqual([]);
    expect(onUpdate).not.toHaveBeenCalled();
    scoped.detach();
  });

  it('removes its own listener when a reentrant attachment supersedes it', () => {
    // The commit is identity-gated: an attempt whose listener was replaced
    // mid-`addEventListener` must not claim ownership, and must take its own
    // listener back off the target. Committing anyway is invisible in the
    // callbacks — the obsolete listener stays registered but is silenced by the
    // same identity check at dispatch — so only the removal itself shows it.
    bus.detach();
    const target = new EventTarget();
    const windowTarget = target as unknown as Window;
    const nativeAdd = target.addEventListener.bind(target);
    const added: EventListenerOrEventListenerObject[] = [];
    const remove = vi.fn(target.removeEventListener.bind(target));
    let reenter = true;
    Object.defineProperties(target, {
      addEventListener: {
        value: (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          added.push(listener);
          nativeAdd(type, listener, options);
          if (reenter) {
            reenter = false;
            bus.detach();
            bus.attach(windowTarget);
          }
        },
      },
      removeEventListener: { value: remove },
    });

    bus.attach(windowTarget);

    // The reentrant `detach()` removes something too, so a bare "was called"
    // says nothing. What must hold is that the *superseded* attempt's own
    // listener — the first one registered — was taken back off the target.
    const superseded = added[0];
    expect(superseded).toBeDefined();
    // Twice: once by the reentrant `detach()`, once by the superseded attempt
    // taking its own listener back. Committing instead of removing drops the
    // second one, and nothing else in the observable behaviour changes.
    expect(remove.mock.calls.filter((call) => call[1] === superseded)).toHaveLength(2);
    target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('ignores a committed listener that a newer attachment has superseded', () => {
    bus.detach();
    const target = new EventTarget();
    const nativeAdd = target.addEventListener.bind(target);
    Object.defineProperties(target, {
      addEventListener: { value: nativeAdd },
      // An ineffective removal leaves the older listener registered, so both
      // receive the event and only ownership can tell them apart.
      removeEventListener: { value: (): void => {} },
    });
    const windowTarget = target as unknown as Window;

    bus.attach(windowTarget);
    bus.detach();
    bus.attach(windowTarget);

    target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));

    // Both listeners are live; the superseded one must stay silent.
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('ignores a message delivered while its own attachment is still registering', () => {
    bus.detach();
    const target = new EventTarget();
    const nativeAdd = target.addEventListener.bind(target);
    const nativeRemove = target.removeEventListener.bind(target);
    Object.defineProperties(target, {
      addEventListener: {
        value: (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          nativeAdd(type, listener, options);
          // The bound listener is already recorded at this point but the
          // attachment has not committed, so this delivery falls into the one
          // window where identity alone cannot decide ownership.
          target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));
        },
      },
      removeEventListener: { value: nativeRemove },
    });

    bus.attach(target as unknown as Window);
    expect(onUpdate).not.toHaveBeenCalled();

    // The very same listener serves normally once the transaction committed.
    target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('leaves no listener when addEventListener detaches reentrantly', () => {
    bus.detach();
    const target = new EventTarget();
    const nativeAdd = target.addEventListener.bind(target);
    const nativeRemove = target.removeEventListener.bind(target);
    Object.defineProperties(target, {
      addEventListener: {
        value: (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          nativeAdd(type, listener, options);
          bus.detach();
        },
      },
      removeEventListener: { value: nativeRemove },
    });

    bus.attach(target as unknown as Window);
    target.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: {} }, TRUSTED));

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps revisions monotonic across attachment generations', () => {
    const first = { type: 'payload-live-preview' as const, data: { id: 'first' } };
    const second = { type: 'payload-live-preview' as const, data: { id: 'second' } };
    const third = { type: 'payload-live-preview' as const, data: { id: 'third' } };

    window.dispatchEvent(makeMessage(first, TRUSTED));
    window.dispatchEvent(makeMessage(second, TRUSTED));
    expect(onUpdate).toHaveBeenNthCalledWith(1, first, TRUSTED, {
      generation: 1,
      revision: 1,
    });
    expect(onUpdate).toHaveBeenNthCalledWith(2, second, TRUSTED, {
      generation: 1,
      revision: 2,
    });

    bus.detach();
    bus.attach();
    window.dispatchEvent(makeMessage(third, TRUSTED));
    expect(onUpdate).toHaveBeenNthCalledWith(3, third, TRUSTED, {
      generation: 2,
      revision: 3,
    });
  });
});

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

describe('MessageBus.sendReady', () => {
  it('posts ready to every target × origin combination', () => {
    const postA = vi.fn();
    const postB = vi.fn();
    const targetA = { postMessage: postA } as unknown as Window;
    const targetB = { postMessage: postB } as unknown as Window;
    MessageBus.sendReady([targetA, targetB], [TRUSTED, UNTRUSTED]);
    expect(postA.mock.calls).toHaveLength(2);
    expect(postB.mock.calls).toHaveLength(2);
    expect(postA).toHaveBeenNthCalledWith(
      1,
      {
        type: 'payload-live-preview',
        ready: true,
        protocolVersion: 4,
      },
      TRUSTED,
    );
    expect(typeof (postA.mock.calls[0]?.[0] as { ready?: unknown } | undefined)?.ready).toBe(
      'boolean',
    );
  });

  it('is a no-op when no targets are given', () => {
    const post = vi.fn();
    const target = { postMessage: post } as unknown as Window;
    MessageBus.sendReady([], [TRUSTED]);
    MessageBus.sendReady([target], []);
    expect(post).not.toHaveBeenCalled();
  });

  it('swallows postMessage exceptions for malformed origins', () => {
    const broken = {
      postMessage: vi.fn(() => {
        throw new Error('invalid origin');
      }),
    } as unknown as Window;
    expect(() => {
      MessageBus.sendReady([broken], ['malformed']);
    }).not.toThrow();
  });
});
