import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetIntlCache,
  getDateTimeFormat,
  getNumberFormat,
  intlCacheSize,
  setIntlCacheLimit,
} from '@core/intl-cache';

afterEach(() => {
  __resetIntlCache();
});

describe('intl-cache — NumberFormat', () => {
  it('returns the same instance for identical locale + options', () => {
    const a = getNumberFormat('en-US');
    const b = getNumberFormat('en-US');
    expect(a).toBe(b);
  });

  it('keys distinct locales separately', () => {
    const en = getNumberFormat('en-US');
    const de = getNumberFormat('de-DE');
    expect(en).not.toBe(de);
  });

  it('normalises option-object key order', () => {
    const a = getNumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const b = getNumberFormat('en-US', { currency: 'USD', style: 'currency' });
    expect(a).toBe(b);
  });

  it('treats undefined-valued option keys as absent', () => {
    const bare = getNumberFormat('en-US');
    const optionsWithUndefined: Intl.NumberFormatOptions = { currency: undefined };
    const withUndefined = getNumberFormat('en-US', optionsWithUndefined);
    expect(bare).toBe(withUndefined);
  });

  it('still formats correctly when cached', () => {
    const formatter = getNumberFormat('de-DE');
    expect(formatter.format(1234.5)).toBe('1.234,5');
    // Second call goes through the cache — same output.
    expect(getNumberFormat('de-DE').format(1234.5)).toBe('1.234,5');
  });
});

describe('intl-cache — DateTimeFormat', () => {
  it('caches by locale + options', () => {
    const a = getDateTimeFormat('en-US', { dateStyle: 'short' });
    const b = getDateTimeFormat('en-US', { dateStyle: 'short' });
    expect(a).toBe(b);
  });

  it('distinguishes option variants', () => {
    const short = getDateTimeFormat('en-US', { dateStyle: 'short' });
    const medium = getDateTimeFormat('en-US', { dateStyle: 'medium' });
    expect(short).not.toBe(medium);
  });
});

describe('intl-cache — LRU bound', () => {
  it('honours the configured limit', () => {
    setIntlCacheLimit(2);
    getNumberFormat('en-US');
    getNumberFormat('de-DE');
    getNumberFormat('fr-FR'); // evicts en-US (oldest)
    expect(intlCacheSize().numbers).toBe(2);

    // en-US was evicted, so requesting it must construct a fresh
    // instance (not the original one that was thrown away).
    const enAgain = getNumberFormat('en-US');
    const enDirect = new Intl.NumberFormat('en-US');
    expect(enAgain.resolvedOptions().locale).toBe(enDirect.resolvedOptions().locale);
  });

  it('reorders recently-used keys (touch on hit)', () => {
    setIntlCacheLimit(2);
    const a = getNumberFormat('en-US');
    getNumberFormat('de-DE');
    // Touch en-US so de-DE becomes the LRU.
    expect(getNumberFormat('en-US')).toBe(a);
    getNumberFormat('fr-FR'); // evicts de-DE
    expect(intlCacheSize().numbers).toBe(2);
    expect(getNumberFormat('en-US')).toBe(a); // still cached
  });

  it('ignores non-positive or non-finite limit overrides', () => {
    const previous = setIntlCacheLimit(0);
    expect(typeof previous).toBe('number');
    // Limit unchanged, cache still functional.
    getNumberFormat('en-US');
    expect(intlCacheSize().numbers).toBe(1);
  });
});

describe('intl-cache — option shapes the key builder has to survive', () => {
  it('keys an array-valued option by its contents, not by identity', () => {
    // `Intl` takes arrays for some options; two equal arrays are one entry.
    const first = getDateTimeFormat('en-US', { fractionalSecondDigits: 2, era: 'short' });
    const second = getDateTimeFormat('en-US', { era: 'short', fractionalSecondDigits: 2 });
    expect(second).toBe(first);
    expect(intlCacheSize().dates).toBe(1);
  });

  it('collapses an empty or absent option object onto the bare locale', () => {
    const bare = getNumberFormat('en-US');
    expect(getNumberFormat('en-US', {})).toBe(bare);
    expect(getNumberFormat('en-US', undefined)).toBe(bare);
    expect(intlCacheSize().numbers).toBe(1);
  });

  it('keys nested and array-valued options structurally', () => {
    const options = { numberingSystem: 'latn' } as const;
    const nested = getNumberFormat('en-US', options);
    expect(getNumberFormat('en-US', { ...options })).toBe(nested);
  });

  it('keys an option value that is an array by its contents', () => {
    // No `Intl` option is declared as an array today, so this is deliberately
    // off-type: the key builder must serialise whatever object it is handed,
    // or a future array-valued option would silently share one cache slot.
    const withArray = (value: readonly unknown[]): Intl.NumberFormatOptions =>
      ({ scale: value }) as unknown as Intl.NumberFormatOptions;

    const first = getNumberFormat('en-US', withArray([1, 2]));
    expect(getNumberFormat('en-US', withArray([1, 2]))).toBe(first);
    expect(getNumberFormat('en-US', withArray([2, 1]))).not.toBe(first);
    expect(getNumberFormat('en-US', withArray([[1], { a: 2 }]))).not.toBe(first);
  });
});

describe('intl-cache — telemetry', () => {
  it('reports per-formatter sizes independently', () => {
    expect(intlCacheSize()).toEqual({ numbers: 0, dates: 0 });
    getNumberFormat('en-US');
    getDateTimeFormat('de-DE');
    getDateTimeFormat('fr-FR');
    expect(intlCacheSize()).toEqual({ numbers: 1, dates: 2 });
  });
});
