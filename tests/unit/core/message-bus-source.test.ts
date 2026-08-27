import { describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';

/**
 * `eventSourcePolicy: 'parent-or-opener'` (ADR 0007, row "messages must
 * come from parent/opener"): the origin allow-list says *who* may talk, the
 * source policy says *from which window*. A same-origin sibling frame or a
 * script on the page itself passes the first and must fail the second.
 */

const TRUSTED = 'https://admin.example.com';
type BusHandlers = ConstructorParameters<typeof MessageBus>[1];

/** A window stand-in: an EventTarget with the two relations the policy reads. */
function fakeWindow(relations: { parent?: object; opener?: object | null } = {}): Window {
  const target = new EventTarget() as unknown as Window & { parent: unknown; opener: unknown };
  Object.defineProperties(target, {
    parent: { value: relations.parent ?? target, configurable: true },
    opener: { value: relations.opener ?? null, configurable: true },
  });
  return target;
}

/** A message event whose `source` is `source`; jsdom would reject a plain object, so it is defined on the instance. */
function messageFrom(source: unknown, data: unknown = { type: 'payload-live-preview', data: {} }) {
  const event = new MessageEvent('message', { data, origin: TRUSTED });
  Object.defineProperty(event, 'source', { value: source, configurable: true });
  return event;
}

function bus(policy: 'any' | 'parent-or-opener' | undefined, target: Window) {
  const onUpdate = vi.fn<BusHandlers['onUpdate']>();
  const onInvalid = vi.fn<NonNullable<BusHandlers['onInvalid']>>();
  const instance = new MessageBus((origin) => origin === TRUSTED, {
    onUpdate,
    onDocumentEvent: vi.fn(),
    onInvalid,
    ...(policy !== undefined ? { sourcePolicy: policy } : {}),
  });
  instance.attach(target);
  return { onUpdate, onInvalid, detach: () => instance.detach() };
}

describe("MessageBus — sourcePolicy 'parent-or-opener'", () => {
  it('accepts the parent of a framed page', () => {
    const parent = {};
    const page = fakeWindow({ parent });
    const { onUpdate, onInvalid, detach } = bus('parent-or-opener', page);
    page.dispatchEvent(messageFrom(parent));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onInvalid).not.toHaveBeenCalled();
    detach();
  });

  it('accepts the opener of a popped-up page', () => {
    const opener = {};
    const page = fakeWindow({ opener });
    const { onUpdate, detach } = bus('parent-or-opener', page);
    page.dispatchEvent(messageFrom(opener));
    expect(onUpdate).toHaveBeenCalledOnce();
    detach();
  });

  it('refuses a sibling frame, the page itself, and a null source — with reason "source"', () => {
    const parent = {};
    const page = fakeWindow({ parent });
    const { onUpdate, onInvalid, detach } = bus('parent-or-opener', page);
    page.dispatchEvent(messageFrom({}));
    page.dispatchEvent(messageFrom(page));
    page.dispatchEvent(messageFrom(null));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(3);
    for (const call of onInvalid.mock.calls) expect(call[0]).toBe('source');
    detach();
  });

  it('refuses everything for a top-level page with no opener — there is no legitimate sender', () => {
    const page = fakeWindow();
    const { onUpdate, onInvalid, detach } = bus('parent-or-opener', page);
    page.dispatchEvent(messageFrom({}));
    page.dispatchEvent(messageFrom(page));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(2);
    detach();
  });

  it('checks the origin first, so a wrong origin is still reported as "origin"', () => {
    const parent = {};
    const page = fakeWindow({ parent });
    const { onInvalid, detach } = bus('parent-or-opener', page);
    const event = new MessageEvent('message', {
      data: { type: 'payload-live-preview', data: {} },
      origin: 'https://evil.example.com',
    });
    Object.defineProperty(event, 'source', { value: {}, configurable: true });
    page.dispatchEvent(event);
    expect(onInvalid).toHaveBeenCalledWith('origin', 'https://evil.example.com');
    detach();
  });

  it('treats a source accessor that throws as a mismatch', () => {
    const parent = {};
    const page = fakeWindow({ parent });
    const { onUpdate, onInvalid, detach } = bus('parent-or-opener', page);
    const event = new MessageEvent('message', {
      data: { type: 'payload-live-preview', data: {} },
      origin: TRUSTED,
    });
    Object.defineProperty(event, 'source', {
      get() {
        throw new Error('hostile accessor');
      },
      configurable: true,
    });
    page.dispatchEvent(event);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('source', TRUSTED);
    detach();
  });
});

describe("MessageBus — sourcePolicy 'any' (default)", () => {
  it('accepts any window that passes the origin check, as 1.x always has', () => {
    const page = fakeWindow();
    for (const policy of ['any', undefined] as const) {
      const { onUpdate, onInvalid, detach } = bus(policy, page);
      page.dispatchEvent(messageFrom({}));
      page.dispatchEvent(messageFrom(null));
      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onInvalid).not.toHaveBeenCalled();
      detach();
    }
  });
});
