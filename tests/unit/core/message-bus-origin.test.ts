import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { TRUSTED, makeMessage } from './message-bus-harness';

describe('MessageBus — origin and source policy', () => {
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
    const scoped = new MessageBus(
      (origin) => {
        seen.push(origin);
        return origin === TRUSTED;
      },
      { onUpdate, onDocumentEvent: () => undefined },
    );
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
});
