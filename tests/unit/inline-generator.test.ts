import { describe, expect, it } from 'vitest';
import { generateInlineScript, wrapWithScriptTag, runtimeBuildInfo } from '@inline/generator';

describe('generateInlineScript', () => {
  it('emits a self-contained string that begins with a header', () => {
    const script = generateInlineScript();
    expect(script).toMatch(/^\/\* @relative23\/payload-live-preview runtime/);
  });

  it('injects the configuration object literal', () => {
    const script = generateInlineScript({
      allowedOrigins: ['https://admin.example.com'],
      debug: true,
      debounceMs: 250,
      enableA11y: false,
      heartbeatMs: 60_000,
    });
    expect(script).toContain('"additionalOrigins":["https://admin.example.com"]');
    expect(script).toContain('"debug":true');
    expect(script).toContain('"debounceMs":250');
    expect(script).toContain('"enableA11y":false');
    expect(script).toContain('"heartbeatMs":60000');
  });

  it('sets sensible defaults when no config is provided', () => {
    const script = generateInlineScript();
    expect(script).toContain('"additionalOrigins":[]');
    expect(script).toContain('"serverURL":""');
    expect(script).toContain('"apiRoute":"/api"');
    expect(script).toContain('"mergeDepth":1');
    expect(script).toContain('"debug":false');
    expect(script).toContain('"debounceMs":50');
    expect(script).toContain('"enableA11y":true');
    // The Payload admin sends no keepalive — heartbeat defaults to off.
    expect(script).toContain('"heartbeatMs":0');
    expect(script).toContain('"disableVisibilityGate":false');
    expect(script).toContain('"visibilityGateThreshold":50');
    expect(script).toContain('"intersectionRootMargin":"200px"');
    expect(script).toContain('"disableReferrerDetection":false');
    expect(script).toContain('"disableLocalhostMatching":false');
  });

  it('bakes the serverURL merge config when provided', () => {
    const script = generateInlineScript({
      serverURL: 'https://cms.example.com',
      mergeDepth: 2,
    });
    expect(script).toContain('"serverURL":"https://cms.example.com"');
    expect(script).toContain('"mergeDepth":2');
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
    expect(script).toContain('"disableVisibilityGate":true');
    expect(script).toContain('"visibilityGateThreshold":200');
    expect(script).toContain('"intersectionRootMargin":"500px"');
  });

  it('forwards origin-detection toggles into the runtime config', () => {
    const script = generateInlineScript({
      disableReferrerDetection: true,
      disableLocalhostMatching: true,
    });
    expect(script).toContain('"disableReferrerDetection":true');
    expect(script).toContain('"disableLocalhostMatching":true');
  });

  it('includes the build-time runtime IIFE', () => {
    const script = generateInlineScript();
    // esbuild emits either a `(function(){})()` or `(()=>{})()` IIFE.
    expect(script).toMatch(/\(\(\)=>|\(function/);
    // It must contain references to message-bus and lifecycle features.
    expect(script).toMatch(/postMessage|payload-live-preview/);
  });

  it('embeds the __INLINE_BUILD__ flag so the runtime auto-starts', () => {
    const script = generateInlineScript();
    expect(script).toContain('var __INLINE_BUILD__=true');
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
