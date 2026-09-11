import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  generateInlineScript,
  generateLoaderScript,
  wrapWithScriptTag,
  runtimeBuildInfo,
  type InlineScriptConfig,
} from '@inline/generator';
import { INLINE_CONFIG_KEYS } from '@/types/inline-config';

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

  it('carries hydration in its own trailing wire slot; the inline script needs no prelude for it', () => {
    // ADR 0015: the runtime is the first script in <head> and arms the signal
    // itself, so the inline script carries the slot and nothing else.
    const script = generateInlineScript({ hydration: 'react' });
    const config = generatedConfig(script);

    expect(config).toHaveLength(24);
    expect(config[23]).toBe('react');
    expect(config.slice(0, 23).every((value) => value === undefined)).toBe(true);
    expect(script).not.toContain('var __LIVE_PREVIEW_HYDRATION__=');
    expect(generateInlineScript()).not.toContain('var __LIVE_PREVIEW_HYDRATION__=');
  });

  it('emits the route prelude alone when routeStrategy is set without a fragment endpoint', () => {
    const script = generateInlineScript({ routeStrategy: true });
    const config = generatedConfig(script);

    expect(config).toHaveLength(20);
    expect(config[19]).toBe(true);
    expect(script).toContain('var __LIVE_PREVIEW_ROUTE__=');
    expect(script).not.toContain('var __LIVE_PREVIEW_FRAGMENT__=');
  });

  it('emits the fragment prelude alone when both are asked for; it already carries the route strategy', () => {
    const script = generateInlineScript({
      fragmentEndpoint: '/payload/fragment',
      routeStrategy: true,
    });

    expect(script).toContain('var __LIVE_PREVIEW_FRAGMENT__=');
    expect(script).not.toContain('var __LIVE_PREVIEW_ROUTE__=');
  });

  it('keeps a page that asks for neither byte-identical to before', () => {
    const script = generateInlineScript();

    expect(script).not.toContain('var __LIVE_PREVIEW_ROUTE__=');
    expect(script).not.toContain('var __LIVE_PREVIEW_FRAGMENT__=');
  });

  it('leaves the fragment client out of the route prelude', () => {
    // The point of the split. The codes name it better than a byte count: the
    // endpoint's refusal (LP0803) and its superseded response (LP0804) cannot
    // occur without a fragment endpoint, so their absence proves the request,
    // protocol and abort machinery stayed behind.
    const routeOnly = generateInlineScript({ routeStrategy: true }).split('\n')[1] ?? '';
    const withFragments = generateInlineScript({ fragmentEndpoint: '/f' }).split('\n')[1] ?? '';

    expect(new Set(routeOnly.match(/LP0[0-9]{3}/gu) ?? [])).toEqual(
      new Set(['LP0801', 'LP0802', 'LP0805']),
    );
    expect(routeOnly.length).toBeLessThan(withFragments.length);
  });

  it('ships no diagnostic-code table in the prelude, only the codes the fragment client reports', () => {
    const prelude = generateInlineScript({ fragmentEndpoint: '/payload/fragment' }).split('\n')[1];
    // The prelude re-exports DIAGNOSTIC_CODES through the fragment barrel, so
    // only tree-shaking keeps the frozen table — a full kilobyte, doctor codes
    // included — out of every fragment-enabled page.
    expect(prelude).toContain('__LIVE_PREVIEW_FRAGMENT__');
    expect(new Set(prelude?.match(/LP0[0-9]{3}/gu) ?? [])).toEqual(
      new Set(['LP0801', 'LP0802', 'LP0803', 'LP0804', 'LP0805']),
    );
  });

  it('no longer accepts the 1.x nonce option; the nonce belongs to wrapWithScriptTag', () => {
    // @ts-expect-error -- removed in 2.0 (ADR 0007 §2); ignored at runtime.
    const withNonce = generateInlineScript({ nonce: 'abc123' });
    expect(withNonce).toBe(generateInlineScript());
  });

  it('refuses serverURL without mergeDepth under the 2.0 defaults, like the client and the adapters', () => {
    expect(() => generateInlineScript({ serverURL: 'https://cms.example.com' })).toThrow(
      /mergeDepth/u,
    );
    expect(() =>
      generateLoaderScript({ serverURL: 'https://cms.example.com' }, { runtimeSrc: '/x.js' }),
    ).toThrow(/mergeDepth/u);
    const v1 = generatedConfig(
      generateInlineScript({ serverURL: 'https://cms.example.com', defaults: 'v1' }),
    );
    // `defaults` is not a wire slot: the runtime's own defaults stay the v2 rows.
    expect(v1).toHaveLength(2);
    expect(v1[1]).toBe('https://cms.example.com');
  });

  it('treats null like an omitted option', () => {
    const nullish = {
      serverURL: null,
      debounceMs: null,
      debug: true,
    } as unknown as InlineScriptConfig;
    const config = generatedConfig(generateInlineScript(nullish));
    expect(config).toHaveLength(5);
    expect(config.slice(0, 4).every((value) => value === undefined)).toBe(true);
    expect(config[4]).toBe(true);
    expect(generateInlineScript(nullish).split('\n', 1)[0]).not.toContain('null');
    expect(() =>
      generateInlineScript({
        serverURL: 'https://cms.example.com',
        mergeDepth: null,
      } as unknown as InlineScriptConfig),
    ).toThrow(/mergeDepth/u);
  });

  it('writes the slots in INLINE_CONFIG_KEYS order, the one table the runtime destructures', () => {
    expect(INLINE_CONFIG_KEYS).toHaveLength(24);
    expect(INLINE_CONFIG_KEYS.indexOf('fragmentEndpoint')).toBe(17);
    expect(INLINE_CONFIG_KEYS.indexOf('revealEditedField')).toBe(18);
    expect(INLINE_CONFIG_KEYS.indexOf('routeStrategy')).toBe(19);
    expect(INLINE_CONFIG_KEYS.indexOf('onUnboundChange')).toBe(20);
    expect(INLINE_CONFIG_KEYS.indexOf('onUnfaithfulPatch')).toBe(21);
    expect(INLINE_CONFIG_KEYS.indexOf('autoBind')).toBe(22);
    expect(INLINE_CONFIG_KEYS.indexOf('hydration')).toBe(23);
    const every = Object.fromEntries(
      INLINE_CONFIG_KEYS.map((key, index) => [key, `slot-${String(index)}`]),
    ) as unknown as InlineScriptConfig;
    expect(generatedConfig(generateInlineScript({ ...every, mergeDepth: 1 }))).toEqual(
      INLINE_CONFIG_KEYS.map((key, index) => (key === 'mergeDepth' ? 1 : `slot-${String(index)}`)),
    );
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
