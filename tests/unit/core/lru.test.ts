/**
 * The LRU contract every module-scoped cache relies on (ADR 0003 §3): a hit
 * is a touch, a write past the bound drops the least recently used entry.
 */

import { describe, expect, it } from 'vitest';
import { lruGet, lruSet, lruTrim } from '@core/lru';

describe('lru', () => {
  it('reads back what was written and misses with undefined', () => {
    const map = new Map<string, object>();
    const value = {};
    expect(lruSet(map, 'a', value, 2)).toBe(value);
    expect(lruGet(map, 'a')).toBe(value);
    expect(lruGet(map, 'b')).toBeUndefined();
    expect(map.size).toBe(1);
  });

  it('drops the oldest entry once the bound is passed', () => {
    const map = new Map<string, object>();
    lruSet(map, 'a', {}, 2);
    lruSet(map, 'b', {}, 2);
    lruSet(map, 'c', {}, 2);
    expect(lruGet(map, 'a')).toBeUndefined();
    expect(map.size).toBe(2);
  });

  it('a hit protects an entry: the least recently used one goes, not the oldest', () => {
    const map = new Map<string, object>();
    const a = {};
    lruSet(map, 'a', a, 2);
    lruSet(map, 'b', {}, 2);
    lruGet(map, 'a');
    lruSet(map, 'c', {}, 2);
    expect(lruGet(map, 'a')).toBe(a);
    expect(lruGet(map, 'b')).toBeUndefined();
  });

  it('trimming to a lower bound keeps the newest entries', () => {
    const map = new Map<string, object>();
    lruSet(map, 'a', {}, 3);
    lruSet(map, 'b', {}, 3);
    const c = {};
    lruSet(map, 'c', c, 3);
    lruTrim(map, 1);
    expect(map.size).toBe(1);
    expect(lruGet(map, 'c')).toBe(c);
  });
});
