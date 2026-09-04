import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDevMode, isInIframe, isInPopup, isInPreviewContext } from '@detection/environment';

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
    vi.unstubAllGlobals();
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

  it('answers from the hostname without NODE_ENV, as a browser bundle must', () => {
    delete process.env['NODE_ENV'];
    // jsdom serves from localhost.
    expect(window.location.hostname).toBe('localhost');
    expect(isDevMode()).toBe(true);
  });

  it('never probes import.meta through Function: an eval would be a CSP violation on every page', () => {
    delete process.env['NODE_ENV'];
    const construct = vi.fn();
    vi.stubGlobal('Function', construct);
    expect(isDevMode()).toBe(true);
    expect(construct).not.toHaveBeenCalled();
  });

  it('reads the loopback host as development too', () => {
    delete process.env['NODE_ENV'];
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
    expect(isDevMode()).toBe(true);
  });

  it('treats any other hostname as production', () => {
    delete process.env['NODE_ENV'];
    vi.stubGlobal('window', { location: { hostname: 'www.example.com' } });
    expect(isDevMode()).toBe(false);
  });

  it('ignores a NODE_ENV that is not a string', () => {
    // `process.env` is string-valued, but a shimmed process on a worker is not.
    vi.stubGlobal('process', { env: { NODE_ENV: 1 } });
    vi.stubGlobal('window', { location: { hostname: 'www.example.com' } });
    expect(isDevMode()).toBe(false);
  });
});

describe('detection off the browser and off Node', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is never development on an edge runtime that has neither process nor window', () => {
    // Guessing development there would switch localhost matching on in production.
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('window', undefined);
    expect(isDevMode()).toBe(false);
  });

  it('is never a preview context without a window', () => {
    vi.stubGlobal('window', undefined);
    expect(isInIframe()).toBe(false);
    expect(isInPopup()).toBe(false);
    expect(isInPreviewContext()).toBe(false);
  });
});
