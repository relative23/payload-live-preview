import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { buildSchemaIndex } from '@schema/walker';
import { TRUSTED, UNTRUSTED, flushMicrotasks, makeMessage } from './message-bus-harness';

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
});
