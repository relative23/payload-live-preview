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
    expect(
      remove.mock.calls.filter((call) => call[0] === 'message' && call[1] === superseded),
    ).toHaveLength(2);
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
  it('replays one deep tokenless snapshot per advanced generation and keeps revisions monotonic', () => {
    const onReplay = vi.fn<NonNullable<BusHandlers['onReplay']>>();
    bus.detach();
    bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onReplay,
      onDocumentEvent,
      onInvalid,
    });
    bus.attach();
    const first = {
      type: 'payload-live-preview' as const,
      data: { hero: { title: 'retained' } },
      previewToken: 'do-not-retain',
    };
    window.dispatchEvent(makeMessage(first, TRUSTED));
    first.data.hero.title = 'mutated after acceptance';

    expect(bus.replayLastAccepted()).toBe(false);
    expect(bus.advanceGeneration()).toBe(true);
    expect(bus.replayLastAccepted()).toBe(true);
    expect(bus.replayLastAccepted()).toBe(false);
    expect(onReplay).toHaveBeenCalledWith(
      { type: 'payload-live-preview', data: { hero: { title: 'retained' } } },
      TRUSTED,
      { generation: 2, revision: 2 },
    );

    const next = { type: 'payload-live-preview' as const, data: { hero: { title: 'next' } } };
    window.dispatchEvent(makeMessage(next, TRUSTED));
    expect(onUpdate).toHaveBeenLastCalledWith(next, TRUSTED, {
      generation: 2,
      revision: 3,
    });
  });
  it('gives each replay its own clone instead of exposing the retained snapshot', () => {
    const replayedTitles: string[] = [];
    const onReplay = vi.fn<NonNullable<BusHandlers['onReplay']>>((message) => {
      const hero = message.data?.['hero'] as { title: string };
      replayedTitles.push(hero.title);
      hero.title = 'mutated by consumer';
    });
    bus.detach();
    bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onReplay,
      onDocumentEvent,
      onInvalid,
    });
    bus.attach();
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { hero: { title: 'retained' } } }, TRUSTED),
    );

    bus.advanceGeneration();
    expect(bus.replayLastAccepted()).toBe(true);
    bus.advanceGeneration();
    expect(bus.replayLastAccepted()).toBe(true);

    expect(replayedTitles).toEqual(['retained', 'retained']);
  });
  it('does not let an older clone boundary overwrite a reentrant accepted update', () => {
    const onReplay = vi.fn<NonNullable<BusHandlers['onReplay']>>();
    bus.detach();
    bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onReplay,
      onDocumentEvent,
      onInvalid,
    });
    bus.attach();
    let reentered = false;
    const newer = { type: 'payload-live-preview' as const, data: { title: 'newer' } };
    const hero = {} as { title: string };
    Object.defineProperty(hero, 'title', {
      enumerable: true,
      get: () => {
        if (!reentered) {
          reentered = true;
          window.dispatchEvent(makeMessage(newer, TRUSTED));
        }
        return 'older';
      },
    });

    window.dispatchEvent(makeMessage({ type: 'payload-live-preview', data: { hero } }, TRUSTED));

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(newer, TRUSTED, {
      generation: 1,
      revision: 2,
    });
    bus.advanceGeneration();
    expect(bus.replayLastAccepted()).toBe(true);
    expect(onReplay).toHaveBeenCalledWith(newer, TRUSTED, {
      generation: 2,
      revision: 3,
    });
  });
  it('abandons a replay when origin matching accepts a newer update reentrantly', () => {
    const onReplay = vi.fn<NonNullable<BusHandlers['onReplay']>>();
    const newer = { type: 'payload-live-preview' as const, data: { title: 'newer' } };
    let reenter = false;
    bus.detach();
    bus = new MessageBus(
      (origin) => {
        if (reenter) {
          reenter = false;
          window.dispatchEvent(makeMessage(newer, TRUSTED));
        }
        return origin === TRUSTED;
      },
      { onUpdate, onReplay, onDocumentEvent, onInvalid },
    );
    bus.attach();
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'older' } }, TRUSTED),
    );
    bus.advanceGeneration();

    reenter = true;
    expect(bus.replayLastAccepted()).toBe(false);
    expect(onReplay).not.toHaveBeenCalled();

    bus.advanceGeneration();
    expect(bus.replayLastAccepted()).toBe(true);
    expect(onReplay).toHaveBeenCalledWith(newer, TRUSTED, {
      generation: 3,
      revision: 3,
    });
  });
  it('does not replay a snapshot whose origin the matcher no longer accepts', () => {
    const onReplay = vi.fn<NonNullable<BusHandlers['onReplay']>>();
    let accepted = TRUSTED;
    bus.detach();
    bus = new MessageBus((origin) => origin === accepted, {
      onUpdate,
      onReplay,
      onDocumentEvent,
      onInvalid,
    });
    bus.attach();
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'retained' } }, TRUSTED),
    );
    bus.advanceGeneration();

    // An origin lock narrowed the matcher after the snapshot was accepted.
    accepted = 'https://other-admin.example.com';
    expect(bus.replayLastAccepted()).toBe(false);
    expect(onReplay).not.toHaveBeenCalled();

    // The refusal did not claim the generation: the same origin replays once it is accepted again.
    accepted = TRUSTED;
    expect(bus.replayLastAccepted()).toBe(true);
    expect(onReplay).toHaveBeenCalledOnce();
  });
  it('reports no replay and consumes no revision without a replay consumer', () => {
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'retained' } }, TRUSTED),
    );
    bus.advanceGeneration();

    expect(bus.replayLastAccepted()).toBe(false);

    const next = { type: 'payload-live-preview' as const, data: { title: 'next' } };
    window.dispatchEvent(makeMessage(next, TRUSTED));
    expect(onUpdate).toHaveBeenLastCalledWith(next, TRUSTED, { generation: 2, revision: 2 });
  });
  it('forgets the retained snapshot explicitly', () => {
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { title: 'old' } }, TRUSTED),
    );
    bus.forgetLastAccepted();
    bus.advanceGeneration();
    expect(bus.replayLastAccepted()).toBe(false);
  });
  it('processes a synthetic non-cloneable update once without retaining a mutable replay', () => {
    const onReplay = vi.fn<NonNullable<BusHandlers['onReplay']>>();
    bus.detach();
    bus = new MessageBus((origin) => origin === TRUSTED, {
      onUpdate,
      onReplay,
      onDocumentEvent,
      onInvalid,
    });
    bus.attach();
    const message = {
      type: 'payload-live-preview' as const,
      data: { title: 'accepted once', callback: (): void => {} },
    };

    window.dispatchEvent(makeMessage(message, TRUSTED));
    expect(onUpdate).toHaveBeenCalledWith(message, TRUSTED, {
      generation: 1,
      revision: 1,
    });

    bus.advanceGeneration();
    expect(bus.replayLastAccepted()).toBe(false);
    expect(onReplay).not.toHaveBeenCalled();
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
