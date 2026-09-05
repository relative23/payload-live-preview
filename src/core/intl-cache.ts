/**
 * Memoised `Intl` formatters, keyed by locale and options. Constructing them
 * per call dominates render time for arrays of many numeric or date fields,
 * and a formatter is a pure function of its key, so one instance is safe to
 * share across the page. Bounded so a language switcher cannot grow it without
 * limit.
 */

import { lruGet, lruSet, lruTrim } from './lru';

const NUMBER_CACHE = new Map<string, Intl.NumberFormat>();
const DATE_CACHE = new Map<string, Intl.DateTimeFormat>();

const DEFAULT_MAX_ENTRIES = 64;

let maxEntries = DEFAULT_MAX_ENTRIES;

/** Internal test helper — purges every cached formatter. */
export function __resetIntlCache(): void {
  NUMBER_CACHE.clear();
  DATE_CACHE.clear();
  maxEntries = DEFAULT_MAX_ENTRIES;
}

/** Adjust the LRU bound. Returns the previous value. */
export function setIntlCacheLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return maxEntries;
  const previous = maxEntries;
  maxEntries = Math.floor(limit);
  lruTrim(NUMBER_CACHE, maxEntries);
  lruTrim(DATE_CACHE, maxEntries);
  return previous;
}

/** Cache occupancy, for tests and dev observability. */
export function intlCacheSize(): { readonly numbers: number; readonly dates: number } {
  return { numbers: NUMBER_CACHE.size, dates: DATE_CACHE.size };
}

export function getNumberFormat(
  locale: string | undefined,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = buildKey(locale, options);
  return (
    lruGet(NUMBER_CACHE, key) ??
    lruSet(NUMBER_CACHE, key, new Intl.NumberFormat(locale, options), maxEntries)
  );
}

export function getDateTimeFormat(
  locale: string | undefined,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = buildKey(locale, options);
  return (
    lruGet(DATE_CACHE, key) ??
    lruSet(DATE_CACHE, key, new Intl.DateTimeFormat(locale, options), maxEntries)
  );
}

function buildKey(locale: string | undefined, options: unknown): string {
  // Stable key order so equivalent option objects share a slot, and an empty
  // one collapses to the bare-locale key.
  const localePart = locale ?? '';
  if (options === undefined || options === null) return localePart;
  const serialised = stableStringify(options);
  if (serialised === '{}') return localePart;
  return `${localePart}|${serialised}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const inner = record[key];
    if (inner === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(inner)}`);
  }
  return `{${parts.join(',')}}`;
}
