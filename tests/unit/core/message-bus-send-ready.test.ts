import { describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@core/message-bus';
import { TRUSTED, UNTRUSTED } from './message-bus-harness';

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
