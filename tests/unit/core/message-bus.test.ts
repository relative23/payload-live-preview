import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';

const TRUSTED = 'https://admin.example.com';
const UNTRUSTED = 'https://evil.example.com';

function makeMessage(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin });
}

describe('MessageBus — receive', () => {
  let onUpdate: ReturnType<typeof vi.fn>;
  let onDocumentEvent: ReturnType<typeof vi.fn>;
  let onInvalid: ReturnType<typeof vi.fn>;
  let bus: MessageBus;

  beforeEach(() => {
    onUpdate = vi.fn();
    onDocumentEvent = vi.fn();
    onInvalid = vi.fn();
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

  it('routes payload-live-preview messages to onUpdate', () => {
    const message = { type: 'payload-live-preview' as const, data: { title: 'x' } };
    window.dispatchEvent(makeMessage(message, TRUSTED));
    expect(onUpdate).toHaveBeenCalledWith(message, TRUSTED);
  });

  it('routes payload-document-event messages to onDocumentEvent', () => {
    const message = { type: 'payload-document-event' as const, action: 'updated' as const };
    window.dispatchEvent(makeMessage(message, TRUSTED));
    expect(onDocumentEvent).toHaveBeenCalledWith(message, TRUSTED);
  });

  it('reports unknown types via onInvalid', () => {
    window.dispatchEvent(makeMessage({ type: 'mystery' }, TRUSTED));
    expect(onInvalid).toHaveBeenCalledWith('type', TRUSTED);
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
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', ready: true }, TRUSTED),
    );
    expect(onUpdate).toHaveBeenCalledOnce();
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
    window.dispatchEvent(
      makeMessage({ type: 'payload-live-preview', data: { x: 1 } }, TRUSTED),
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('token', TRUSTED);
  });

  it('rejects messages with an unapproved token', () => {
    const { onUpdate, onInvalid } = withValidator((token) => token === 'expected');
    window.dispatchEvent(
      makeMessage(
        { type: 'payload-live-preview', data: { x: 1 }, previewToken: 'wrong' },
        TRUSTED,
      ),
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
    const { onUpdate, onInvalid } = withValidator(() =>
      Promise.reject(new Error('verify failed')),
    );
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
