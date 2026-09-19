import { describe, expect, it } from 'vitest';
import { LifetimeScope } from '@core/lifetime-scope';

/**
 * The scope's own promises: what it owns is released the last first, one
 * release that throws is logged and does not stop the next, closing twice is
 * closing once, and a release owned after the close runs at once.
 */

function scope(): { readonly scope: LifetimeScope; readonly logs: unknown[][] } {
  const logs: unknown[][] = [];
  return {
    scope: new LifetimeScope((...args) => {
      logs.push(args);
    }),
    logs,
  };
}

describe('LifetimeScope', () => {
  it('releases in reverse order of ownership', () => {
    const { scope: s } = scope();
    const order: string[] = [];
    s.own(() => order.push('first'));
    s.own(() => order.push('second'));
    s.own(() => order.push('third'));
    expect(s.closed).toBe(false);
    s.close();
    expect(order).toEqual(['third', 'second', 'first']);
    expect(s.closed).toBe(true);
  });

  it('logs a release that throws and still runs the rest', () => {
    const { scope: s, logs } = scope();
    const order: string[] = [];
    s.own(() => order.push('outer'));
    s.own(() => {
      throw new Error('inner exploded');
    });
    s.own(() => order.push('last'));
    s.close();
    expect(order).toEqual(['last', 'outer']);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.[0]).toBe('runtime cleanup failed:');
    expect((logs[0]?.[1] as Error).message).toBe('inner exploded');
  });

  it('closes once: a second close releases nothing again', () => {
    const { scope: s } = scope();
    let released = 0;
    s.own(() => {
      released += 1;
    });
    s.close();
    s.close();
    expect(released).toBe(1);
  });

  it('runs a release owned after the close at once, guarded the same way', () => {
    const { scope: s, logs } = scope();
    s.close();
    let ran = false;
    s.own(() => {
      ran = true;
    });
    expect(ran).toBe(true);
    s.own(() => {
      throw new Error('late');
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.[0]).toBe('runtime cleanup failed:');
  });

  it('does not hold on to what it released', () => {
    const { scope: s } = scope();
    let count = 0;
    s.own(() => {
      count += 1;
    });
    s.close();
    // Owning after the close runs at once and is not kept either: a second
    // close is a no-op, so nothing owned can run twice.
    s.own(() => {
      count += 1;
    });
    s.close();
    expect(count).toBe(2);
  });
});
