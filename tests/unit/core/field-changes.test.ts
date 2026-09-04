import { describe, expect, it } from 'vitest';
import { FieldChangeTracker } from '@core/field-changes';

describe('FieldChangeTracker', () => {
  it('reports every field on the first message and only differences afterwards', () => {
    const tracker = new FieldChangeTracker();
    expect([...tracker.diff({ a: 1, b: 'x' }, {}).changed].sort()).toEqual(['a', 'b']);
    expect([...tracker.diff({ a: 1, b: 'y' }, {}).changed]).toEqual(['b']);
    expect([...tracker.diff({ a: 1, b: 'y' }, {}).changed]).toEqual([]);
  });

  it('compares structurally, so a fresh object graph with equal content is unchanged', () => {
    const tracker = new FieldChangeTracker();
    tracker.diff({ rich: { root: { children: [{ text: 'a' }] } } }, {});
    expect(tracker.diff({ rich: { root: { children: [{ text: 'a' }] } } }, {}).changed.size).toBe(
      0,
    );
    expect([
      ...tracker.diff({ rich: { root: { children: [{ text: 'b' }] } } }, {}).changed,
    ]).toEqual(['rich']);
  });

  it('counts a removed field and a value without identity as changed', () => {
    const tracker = new FieldChangeTracker();
    tracker.diff({ a: 1, gone: 2 }, {});
    expect([...tracker.diff({ a: 1 }, {}).changed]).toEqual(['gone']);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    tracker.diff({ a: cyclic }, {});
    expect([...tracker.diff({ a: cyclic }, {}).changed]).toEqual(['a']);
  });

  it('invalidates the dependents of changed sources only', () => {
    const tracker = new FieldChangeTracker();
    const dependencies = { price: ['priceLabel'], currency: ['priceLabel', 'total'] };
    tracker.diff({ price: 1, currency: 'EUR' }, dependencies);
    const changes = tracker.diff({ price: 2, currency: 'EUR' }, dependencies);
    expect([...changes.changed]).toEqual(['price']);
    expect([...changes.invalidated]).toEqual(['priceLabel']);
  });

  it('forgets the baseline on reset', () => {
    const tracker = new FieldChangeTracker();
    tracker.diff({ a: 1 }, {});
    tracker.reset();
    expect([...tracker.diff({ a: 1 }, {}).changed]).toEqual(['a']);
  });
});
