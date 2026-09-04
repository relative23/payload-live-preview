import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { TRUSTED, makeMessage } from './message-bus-harness';

describe('MessageBus — message shapes', () => {
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
  it('reveals a focused field and rejects a focus message with no field', () => {
    const onFocusField = vi.fn<NonNullable<BusHandlers['onFocusField']>>();
    bus.detach();
    bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onDocumentEvent,
      onInvalid,
      onFocusField,
    });
    bus.attach();

    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview-focus', field: 'heroTitle' }, TRUSTED),
    );
    expect(onFocusField).toHaveBeenCalledWith('heroTitle', TRUSTED);

    onInvalid.mockClear();
    window.dispatchEvent(makeMessage({ type: 'payload-live-preview-focus' }, TRUSTED));
    expect(onInvalid).toHaveBeenCalledWith('shape', TRUSTED);
    window.dispatchEvent(makeMessage({ type: 'payload-live-preview-focus', field: '' }, TRUSTED));
    expect(onFocusField).toHaveBeenCalledTimes(1);
  });
});
