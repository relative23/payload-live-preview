/**
 * LRU discipline for a module-scoped lookup `Map` (ADR 0003 §3). Functions
 * over the caller's own `Map` rather than a wrapper class: the inline bundle
 * mangles function names but not property names, so a class would pay for
 * every `this.entries` in full. A `Map` iterates in insertion order, which a
 * touch on every hit turns into recency order. Values are never `undefined`,
 * and a write follows a miss — a key already present keeps its position.
 */

/** Read and touch: a hit becomes the newest entry. */
export function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

/** Write as the newest entry, dropping the oldest ones past `limit`; returns `value`. */
export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, limit: number): V {
  map.set(key, value);
  lruTrim(map, limit);
  return value;
}

/** Drop the oldest entries until `limit` holds. */
export function lruTrim<K>(map: Map<K, unknown>, limit: number): void {
  for (const oldest of map.keys()) {
    if (map.size <= limit) break;
    map.delete(oldest);
  }
}
