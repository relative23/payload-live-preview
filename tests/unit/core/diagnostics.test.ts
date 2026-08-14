import { describe, expect, it, vi } from 'vitest';
import {
  isolateDiagnostic,
  safeConsoleDebug,
  safeConsoleError,
  safeConsoleWarn,
} from '@core/diagnostics';

describe('isolated diagnostics', () => {
  it('forwards arguments synchronously to an ordinary diagnostic sink', () => {
    const sink = vi.fn();
    const diagnostic = isolateDiagnostic(sink);

    diagnostic('message', 42);

    expect(sink).toHaveBeenCalledWith('message', 42);
  });

  it('contains a synchronous exception from consumer code', () => {
    const diagnostic = isolateDiagnostic(() => {
      throw new Error('logger failed');
    });

    expect(() => diagnostic('message')).not.toThrow();
  });

  it('observes a rejected custom thenable', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async logger failed'));
      },
    );
    const diagnostic = isolateDiagnostic(() => ({ then }));

    diagnostic('message');
    await Promise.resolve();
    await Promise.resolve();

    expect(then).toHaveBeenCalledOnce();
  });

  it('contains an exception thrown while inspecting a hostile thenable', () => {
    const hostile = Object.defineProperty({}, 'then', {
      get: () => {
        throw new Error('then getter failed');
      },
    });
    const diagnostic = isolateDiagnostic(() => hostile);

    expect(() => diagnostic('message')).not.toThrow();
  });

  it('does not assimilate ordinary non-thenable return values', () => {
    const value = Object.defineProperty({}, 'marker', {
      get: () => {
        throw new Error('unrelated getter must not be read');
      },
    });
    const diagnostic = isolateDiagnostic(() => value);

    expect(() => diagnostic('message')).not.toThrow();
  });

  it.each([
    ['error', safeConsoleError],
    ['warn', safeConsoleWarn],
    ['debug', safeConsoleDebug],
  ] as const)('forwards the %s console channel and contains a throwing host', (method, safe) => {
    const consoleMethod = vi.spyOn(console, method).mockImplementationOnce(() => undefined);

    safe('message', 42);

    expect(consoleMethod).toHaveBeenCalledWith('message', 42);

    consoleMethod.mockImplementationOnce(() => {
      throw new Error('host console failed');
    });
    expect(() => safe('second message')).not.toThrow();
    consoleMethod.mockRestore();
  });

  it('observes a rejected result from a replaced console method', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async console failed'));
      },
    );
    const original = console.warn;
    const replacement: (...args: unknown[]) => unknown = () => ({ then });
    Reflect.set(console, 'warn', replacement);

    try {
      safeConsoleWarn('message');
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      Reflect.set(console, 'warn', original);
    }

    expect(then).toHaveBeenCalledOnce();
  });

  it('contains a hostile console method accessor', () => {
    const original = Object.getOwnPropertyDescriptor(console, 'error');
    Object.defineProperty(console, 'error', {
      configurable: true,
      get: () => {
        throw new Error('console accessor failed');
      },
    });

    try {
      expect(() => safeConsoleError('message')).not.toThrow();
    } finally {
      if (original === undefined) Reflect.deleteProperty(console, 'error');
      else Object.defineProperty(console, 'error', original);
    }
  });
});
