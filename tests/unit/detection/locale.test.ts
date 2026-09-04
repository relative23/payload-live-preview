import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectInitialLocale } from '@detection/locale';

describe('detectInitialLocale', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('lang');
  });
  afterEach(() => {
    document.documentElement.removeAttribute('lang');
  });

  it('returns the <html lang="..."> value when set', () => {
    document.documentElement.setAttribute('lang', 'de-AT');
    expect(detectInitialLocale()).toBe('de-AT');
  });

  it('ignores empty <html lang="">', () => {
    document.documentElement.setAttribute('lang', '');
    // navigator.language in jsdom defaults to "en-US"
    expect(detectInitialLocale()).toMatch(/^[a-z]{2}/);
  });

  it('falls back to navigator.language when no html lang', () => {
    const result = detectInitialLocale();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to English when the navigator names no usable language', () => {
    vi.stubGlobal('navigator', { language: '' });
    expect(detectInitialLocale()).toBe('en');
    vi.stubGlobal('navigator', { language: 42 });
    expect(detectInitialLocale()).toBe('en');
    vi.unstubAllGlobals();
  });

  it('answers off the browser, where there is neither document nor navigator', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    expect(detectInitialLocale()).toBe('en');
    vi.unstubAllGlobals();
  });
});
