import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { generateInlineScript, wrapWithScriptTag, runtimeBuildInfo } from '@inline/generator';

class InlineIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function generatedConfig(script: string): unknown[] {
  const match = /var __LIVE_PREVIEW_CONFIG__=(\[[^;]*\]);/.exec(script);
  if (match?.[1] === undefined) throw new Error('generated config missing');
  const evaluated = runInNewContext(match[1], {}) as unknown;
  if (!Array.isArray(evaluated)) throw new Error('generated config is not an array');
  return evaluated;
}

describe('generateInlineScript', () => {
  it('keeps the established 1.0.x runtime marker for consumer presence checks', () => {
    const script = generateInlineScript();

    expect(script).toContain('var __LIVE_PREVIEW_CONFIG__=');
    expect(script).not.toContain('__PLL_CONFIG__');
  });

  it('emits a self-contained string without redundant build metadata', () => {
    const script = generateInlineScript();
    expect(script.startsWith('var __LIVE_PREVIEW_CONFIG__=[];\n')).toBe(true);
    expect(script).not.toContain(runtimeBuildInfo().generatedAt);
  });

  it('injects the configuration object literal', () => {
    const script = generateInlineScript({
      allowedOrigins: ['https://admin.example.com'],
      debug: true,
      debounceMs: 250,
      enableA11y: false,
      heartbeatMs: 60_000,
    });
    const config = generatedConfig(script);
    expect(config[0]).toEqual(['https://admin.example.com']);
    expect(config[4]).toBe(true);
    expect(config[5]).toBe(250);
    expect(config[6]).toBe(false);
    expect(config[7]).toBe(60_000);
  });

  it('does not duplicate runtime defaults in the generated config', () => {
    const script = generateInlineScript();
    expect(generatedConfig(script)).toEqual([]);
  });

  it('carries owner scoping in its own trailing wire slot', () => {
    const script = generateInlineScript({ scopeBindingsByOwner: true });
    const config = generatedConfig(script);

    // Appending keeps every existing slot at its established index, so a page
    // still serving an older config literal keeps its meaning.
    expect(config).toHaveLength(14);
    expect(config[13]).toBe(true);
    expect(config.slice(0, 13).every((value) => value === undefined)).toBe(true);
  });

  it('carries skipUnchanged in its own trailing wire slot', () => {
    const script = generateInlineScript({ skipUnchanged: true });
    const config = generatedConfig(script);

    expect(config).toHaveLength(15);
    expect(config[14]).toBe(true);
    expect(config.slice(0, 14).every((value) => value === undefined)).toBe(true);
  });

  it('carries the fragment endpoint in its own trailing wire slot and emits the fragment prelude ahead of the runtime', () => {
    const script = generateInlineScript({ fragmentEndpoint: '/payload/fragment' });
    const config = generatedConfig(script);

    expect(config).toHaveLength(18);
    expect(config[17]).toBe('/payload/fragment');
    expect(config.slice(0, 17).every((value) => value === undefined)).toBe(true);
    expect(script).not.toBe(generateInlineScript());
    expect(script).toContain('var __LIVE_PREVIEW_FRAGMENT__=');
    expect(generateInlineScript()).not.toContain('var __LIVE_PREVIEW_FRAGMENT__=');
  });

  it('retains the deprecated nonce config as a no-op for 1.x compatibility', () => {
    const withoutNonce = generateInlineScript();
    const withNonce = generateInlineScript({ nonce: 'abc123' });

    expect(withNonce).toBe(withoutNonce);
  });

  it('serializes explicit falsy overrides instead of dropping them', () => {
    const script = generateInlineScript({
      debug: false,
      debounceMs: 0,
      enableA11y: false,
      heartbeatMs: 0,
    });

    const config = generatedConfig(script);
    expect(config[4]).toBe(false);
    expect(config[5]).toBe(0);
    expect(config[6]).toBe(false);
    expect(config[7]).toBe(0);
  });

  it('preserves omitted interior options as undefined so runtime defaults apply', () => {
    const script = generateInlineScript({ debug: true, debounceMs: 25 });
    const config = generatedConfig(script);

    expect(config[1]).toBeUndefined();
    expect(config[2]).toBeUndefined();
    expect(config[3]).toBeUndefined();
    expect(config[4]).toBe(true);
    expect(config[5]).toBe(25);
    expect(script.split('\n', 1)[0]).not.toContain('null');
  });

  it('bakes the serverURL merge config when provided', () => {
    const script = generateInlineScript({
      serverURL: 'https://cms.example.com',
      mergeDepth: 2,
    });
    const config = generatedConfig(script);
    expect(config[1]).toBe('https://cms.example.com');
    expect(config[3]).toBe(2);
  });

  it('escapes `<` in config values so `</script>` cannot break the tag', () => {
    const script = generateInlineScript({
      allowedOrigins: ['https://admin.example.com/</script><script>alert(1)'],
    });
    expect(script).not.toContain('</script><script>');
    expect(script).toContain('\\u003C');
  });

  it('forwards visibility-gate options into the runtime config', () => {
    const script = generateInlineScript({
      disableVisibilityGate: true,
      visibilityGateThreshold: 200,
      intersectionRootMargin: '500px',
    });
    const config = generatedConfig(script);
    expect(config[8]).toBe(true);
    expect(config[9]).toBe(200);
    expect(config[10]).toBe('500px');
  });

  it('forwards origin-detection toggles into the runtime config', () => {
    const script = generateInlineScript({
      disableReferrerDetection: true,
      disableLocalhostMatching: true,
    });
    const config = generatedConfig(script);
    expect(config[11]).toBe(true);
    expect(config[12]).toBe(true);
  });

  it('includes the build-time runtime IIFE', () => {
    const script = generateInlineScript();
    // esbuild emits either a `(function(){})()` or `(()=>{})()` IIFE.
    expect(script).toMatch(/\(\(\)=>|\(function/);
    // It must contain references to message-bus and lifecycle features.
    expect(script).toMatch(/postMessage|payload-live-preview/);
  });

  it('keeps the minified ready handshake boolean on the public wire', () => {
    const posted: unknown[] = [];
    const parent = {
      postMessage: (message: unknown) => {
        posted.push(message);
      },
    } as unknown as Window;
    const topDescriptor = Object.getOwnPropertyDescriptor(window, 'top');
    const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
    const intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'IntersectionObserver',
    );

    Object.defineProperty(window, 'top', { configurable: true, value: parent });
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    globalThis.IntersectionObserver = InlineIntersectionObserver;

    try {
      const script = generateInlineScript({
        allowedOrigins: ['https://admin.example.com'],
        debounceMs: 0,
        enableA11y: false,
        heartbeatMs: 0,
        disableVisibilityGate: true,
        disableReferrerDetection: true,
        disableLocalhostMatching: true,
      });

      runInNewContext(script, {
        AbortController,
        clearTimeout,
        console,
        document,
        IntersectionObserver: InlineIntersectionObserver,
        MutationObserver,
        navigator,
        performance,
        setTimeout,
        URL,
        window,
        Window,
      });

      expect(posted).toContainEqual({
        type: 'payload-live-preview',
        ready: true,
        protocolVersion: 4,
      });
      expect(typeof (posted[0] as { ready?: unknown } | undefined)?.ready).toBe('boolean');
    } finally {
      const api = (window as unknown as { __livePreview?: { destroy: () => void } }).__livePreview;
      api?.destroy();
      Reflect.deleteProperty(window, '__livePreview');
      if (topDescriptor !== undefined) Object.defineProperty(window, 'top', topDescriptor);
      if (parentDescriptor !== undefined) Object.defineProperty(window, 'parent', parentDescriptor);
      if (intersectionObserverDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, 'IntersectionObserver');
      } else {
        Object.defineProperty(globalThis, 'IntersectionObserver', intersectionObserverDescriptor);
      }
    }
  });

  it('bakes the auto-start path without a second runtime global', () => {
    const script = generateInlineScript();
    expect(script).not.toContain('__INLINE_BUILD__');
  });
});

describe('wrapWithScriptTag', () => {
  it('wraps the body in <script>…</script>', () => {
    const wrapped = wrapWithScriptTag('alert(1)');
    expect(wrapped).toBe('<script>alert(1)</script>');
  });

  it('adds nonce attribute when provided', () => {
    const wrapped = wrapWithScriptTag('alert(1)', { nonce: 'abc123' });
    expect(wrapped).toBe('<script nonce="abc123">alert(1)</script>');
  });

  it('rejects nonces with invalid characters', () => {
    expect(() => wrapWithScriptTag('x', { nonce: 'bad"injection' })).toThrow(RangeError);
    expect(() => wrapWithScriptTag('x', { nonce: '<script>' })).toThrow(RangeError);
  });
});

describe('runtimeBuildInfo', () => {
  it('exposes generatedAt and size from the build', () => {
    const info = runtimeBuildInfo();
    expect(typeof info.generatedAt).toBe('string');
    expect(typeof info.size).toBe('number');
    expect(info.size).toBeGreaterThan(0);
  });
});
