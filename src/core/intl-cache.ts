/**
 * Shared Intl formatter cache.
 *
 * Constructing `Intl.NumberFormat` / `Intl.DateTimeFormat` per call is
 * surprisingly expensive in tight loops — V8 cannot fully optimise them
 * because the locale → ICU resolution happens behind a `try { … }`.
 * On benchmark traces from the structural-array renderer, formatter
 * construction can dominate render time for arrays of 50+ numeric or
 * date fields.
 *
 * This module memoises formatters by a `(locale, options)` key. The
 * cache is module-scoped — formatters are pure functions of their key,
 * so the same `Intl.NumberFormat('de-DE')` instance is safe to share
 * across every consumer of the library on the page.
 *
 * A bounded LRU keeps the cache from growing without limit when a
 * page renders a wide variety of locales (admin tools, language
 * switchers). The default limit (64) is generous for normal sites and
 * tight enough that any leak would be visible in dev tools.
 *
 * @module @core/intl-cache
 */

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
  trimToLimit(NUMBER_CACHE);
  trimToLimit(DATE_CACHE);
  return previous;
}

/** Read-only telemetry — useful for tests and dev observability. */
export function intlCacheSize(): { readonly numbers: number; readonly dates: number } {
  return { numbers: NUMBER_CACHE.size, dates: DATE_CACHE.size };
}

export function getNumberFormat(
  locale: string | undefined,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = buildKey(locale, options);
  const cached = NUMBER_CACHE.get(key);
  if (cached !== undefined) {
    // Touch → mark as MRU.
    NUMBER_CACHE.delete(key);
    NUMBER_CACHE.set(key, cached);
    return cached;
  }
  const formatter = new Intl.NumberFormat(locale, options);
  NUMBER_CACHE.set(key, formatter);
  trimToLimit(NUMBER_CACHE);
  return formatter;
}

export function getDateTimeFormat(
  locale: string | undefined,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = buildKey(locale, options);
  const cached = DATE_CACHE.get(key);
  if (cached !== undefined) {
    DATE_CACHE.delete(key);
    DATE_CACHE.set(key, cached);
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, options);
  DATE_CACHE.set(key, formatter);
  trimToLimit(DATE_CACHE);
  return formatter;
}

function buildKey(locale: string | undefined, options: unknown): string {
  // `locale` first so the cache stays human-readable in dev tools.
  // `options` is JSON-encoded with a stable key order so equivalent
  // option objects hit the same slot regardless of authoring style.
  // An options object that stringifies to `{}` (all values undefined,
  // or genuinely empty) collapses to no suffix so it shares the same
  // cache slot as a bare call.
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

function trimToLimit(map: Map<string, unknown>): void {
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
