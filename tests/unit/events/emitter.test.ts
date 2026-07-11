import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';

interface TestEventMap {
  readonly ping: { readonly n: number };
  readonly pong: { readonly text: string };
  readonly done: undefined;
}

describe('EventEmitter — registration and dispatch', () => {
  let emitter: EventEmitter<TestEventMap>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEventMap>();
  });

  it('invokes a registered handler with the emitted payload', async () => {
    const handler = vi.fn();
    emitter.on('ping', handler);
    await emitter.emit('ping', { n: 7 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ n: 7 });
  });

  it('invokes handlers in registration order', async () => {
    const order: string[] = [];
    emitter.on('ping', () => {
      order.push('a');
    });
    emitter.on('ping', () => {
      order.push('b');
    });
    emitter.on('ping', () => {
      order.push('c');
    });
    await emitter.emit('ping', { n: 1 });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('returns an unsubscribe function that removes the handler', async () => {
    const handler = vi.fn();
    const unsubscribe = emitter.on('ping', handler);
    unsubscribe();
    await emitter.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit is a no-op when no handlers are registered', async () => {
    await expect(emitter.emit('ping', { n: 1 })).resolves.toBeUndefined();
  });

  it('off removes a specific handler', async () => {
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('ping', a);
    emitter.on('ping', b);
    emitter.off('ping', a);
    await emitter.emit('ping', { n: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('off is a no-op for handlers that are not registered', () => {
    expect(() => {
      emitter.off('ping', () => {});
    }).not.toThrow();
  });
});

describe('EventEmitter — once semantics', () => {
  let emitter: EventEmitter<TestEventMap>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEventMap>();
  });

  it('invokes once handlers exactly once', async () => {
    const handler = vi.fn();
    emitter.once('ping', handler);
    await emitter.emit('ping', { n: 1 });
    await emitter.emit('ping', { n: 2 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('once handlers can be unsubscribed before they fire', async () => {
    const handler = vi.fn();
    const unsubscribe = emitter.once('ping', handler);
    unsubscribe();
    await emitter.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off works for once handlers', async () => {
    const handler = vi.fn();
    emitter.once('ping', handler);
    emitter.off('ping', handler);
    await emitter.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires once handlers after regular handlers in the same emit', async () => {
    const order: string[] = [];
    emitter.on('ping', () => {
      order.push('regular');
    });
    emitter.once('ping', () => {
      order.push('once');
    });
    await emitter.emit('ping', { n: 1 });
    expect(order).toEqual(['regular', 'once']);
  });
});

describe('EventEmitter — async handlers', () => {
  let emitter: EventEmitter<TestEventMap>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEventMap>();
  });

  it('awaits async handlers before resolving emit', async () => {
    let completed = false;
    emitter.on('ping', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed = true;
    });
    await emitter.emit('ping', { n: 1 });
    expect(completed).toBe(true);
  });

  it('runs handlers sequentially, not in parallel', async () => {
    const order: string[] = [];
    emitter.on('ping', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('first');
    });
    emitter.on('ping', () => {
      order.push('second');
    });
    await emitter.emit('ping', { n: 1 });
    expect(order).toEqual(['first', 'second']);
  });
});

describe('EventEmitter — error isolation', () => {
  let emitter: EventEmitter<TestEventMap>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEventMap>();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('continues to invoke later handlers when an earlier one throws', async () => {
    const after = vi.fn();
    emitter.on('ping', () => {
      throw new Error('boom');
    });
    emitter.on('ping', after);
    await emitter.emit('ping', { n: 1 });
    expect(after).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('continues when an async handler rejects', async () => {
    const after = vi.fn();
    emitter.on('ping', () => Promise.reject(new Error('async boom')));
    emitter.on('ping', after);
    await emitter.emit('ping', { n: 1 });
    expect(after).toHaveBeenCalledOnce();
  });

  it('keeps once-handler removal semantics even when the once handler throws', async () => {
    emitter.once('ping', () => {
      throw new Error('boom');
    });
    await emitter.emit('ping', { n: 1 });
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  it('logs with an event-name prefix', async () => {
    emitter.on('ping', () => {
      throw new Error('boom');
    });
    await emitter.emit('ping', { n: 1 });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"ping"'), expect.any(Error));
  });
});

describe('EventEmitter — introspection', () => {
  let emitter: EventEmitter<TestEventMap>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEventMap>();
  });

  it('listenerCount returns 0 for unknown events', () => {
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  it('listenerCount sums regular and once handlers', () => {
    emitter.on('ping', () => {});
    emitter.on('ping', () => {});
    emitter.once('ping', () => {});
    expect(emitter.listenerCount('ping')).toBe(3);
  });

  it('listenerCount decrements after once handler fires', async () => {
    emitter.on('ping', () => {});
    emitter.once('ping', () => {});
    expect(emitter.listenerCount('ping')).toBe(2);
    await emitter.emit('ping', { n: 1 });
    expect(emitter.listenerCount('ping')).toBe(1);
  });

  it('eventNames lists every event with at least one handler', () => {
    emitter.on('ping', () => {});
    emitter.once('pong', () => {});
    expect(new Set(emitter.eventNames())).toEqual(new Set(['ping', 'pong']));
  });

  it('removeAllListeners(event) removes only that event', () => {
    emitter.on('ping', () => {});
    emitter.on('pong', () => {});
    emitter.removeAllListeners('ping');
    expect(emitter.listenerCount('ping')).toBe(0);
    expect(emitter.listenerCount('pong')).toBe(1);
  });

  it('removeAllListeners() with no args removes everything', () => {
    emitter.on('ping', () => {});
    emitter.on('pong', () => {});
    emitter.once('done', () => {});
    emitter.removeAllListeners();
    expect(emitter.eventNames()).toEqual([]);
  });
});

describe('EventEmitter — error label edge cases', () => {
  it('falls back to "<event>" when event name is a symbol', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sym = Symbol('weird');
    interface SymEventMap {
      readonly [sym]: undefined;
    }
    const emitter = new EventEmitter<SymEventMap>();
    emitter.on(sym, () => {
      throw new Error('boom');
    });
    await emitter.emit(sym, undefined);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"<event>"'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});

describe('EventEmitter — multi-instance isolation', () => {
  it('handlers on one instance are not invoked by another', async () => {
    const a = new EventEmitter<TestEventMap>();
    const b = new EventEmitter<TestEventMap>();
    const handler = vi.fn();
    a.on('ping', handler);
    await b.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAllListeners on one instance does not affect another', () => {
    const a = new EventEmitter<TestEventMap>();
    const b = new EventEmitter<TestEventMap>();
    b.on('ping', () => {});
    a.removeAllListeners();
    expect(b.listenerCount('ping')).toBe(1);
  });
});
