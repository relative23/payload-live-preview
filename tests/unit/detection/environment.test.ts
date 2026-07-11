import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isDevMode,
  isInIframe,
  isInPopup,
  isInPreviewContext,
  getEnvVar,
} from '@detection/environment';

describe('isInIframe', () => {
  it('returns false when window.self === window.top', () => {
    expect(isInIframe()).toBe(false);
  });

  it('returns true when the comparison throws (cross-origin iframe)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', {
      get() {
        throw new Error('cross-origin');
      },
      configurable: true,
    });
    try {
      expect(isInIframe()).toBe(true);
    } finally {
      if (original) Object.defineProperty(window, 'top', original);
    }
  });
});

describe('isInPopup', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
  });

  it('returns false when window.opener is null', () => {
    expect(isInPopup()).toBe(false);
  });

  it('returns true when window.opener is set', () => {
    Object.defineProperty(window, 'opener', { value: window, configurable: true });
    expect(isInPopup()).toBe(true);
  });
});

describe('isInPreviewContext', () => {
  it('is the OR of isInIframe and isInPopup', () => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    expect(isInPreviewContext()).toBe(false);
    Object.defineProperty(window, 'opener', { value: window, configurable: true });
    expect(isInPreviewContext()).toBe(true);
  });
});

describe('isDevMode', () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env['NODE_ENV'];
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalEnv;
  });

  it('reports true when NODE_ENV is not production', () => {
    process.env['NODE_ENV'] = 'development';
    expect(isDevMode()).toBe(true);
    process.env['NODE_ENV'] = 'test';
    expect(isDevMode()).toBe(true);
  });

  it('reports false when NODE_ENV is production', () => {
    process.env['NODE_ENV'] = 'production';
    expect(isDevMode()).toBe(false);
  });
});

describe('getEnvVar', () => {
  it('reads from process.env', () => {
    process.env['LP_TEST_VAR'] = 'abc';
    expect(getEnvVar('LP_TEST_VAR')).toBe('abc');
    delete process.env['LP_TEST_VAR'];
  });

  it('returns undefined when the value is missing', () => {
    expect(getEnvVar('LP_DEFINITELY_NOT_SET')).toBeUndefined();
  });

  it('returns undefined for empty strings', () => {
    process.env['LP_EMPTY'] = '';
    expect(getEnvVar('LP_EMPTY')).toBeUndefined();
    delete process.env['LP_EMPTY'];
  });
});
