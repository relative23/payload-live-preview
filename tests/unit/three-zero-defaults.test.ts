import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { livePreview } from '@adapters/astro/index';
import { livePreviewScriptProps } from '@adapters/nextjs/index';
import { resolvePolicyOptions } from '@adapters/shared/policy-options';
import { generateInlineScript } from '@inline/generator';
import { resetDevWarnings } from '@/types/dev-warning';

/**
 * The server half of "3.0 announces itself" (ADR 0026, 2026-11-03): once per
 * process in development, never in production, an adapter or the generator
 * names a merge without a deadline (ADR 0007, row 27), and the Astro integration
 * names the inline default 3.0 replaces with `loader` (row 33). What 3.0 already
 * did is here too: `livePreviewScriptProps()` builds a bootstrap and refuses
 * inline delivery (row 32). The sizes are measured from what was generated, not
 * quoted.
 */

const ADMIN = 'https://admin.example.com';

let warn: MockInstance<typeof console.warn>;
const said = (): string[] => warn.mock.calls.map(([message]) => String(message));

beforeEach(() => {
  resetDevWarnings();
  vi.stubEnv('NODE_ENV', 'development');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
  resetDevWarnings();
});

describe('a merge without a deadline (row 27)', () => {
  it('is named once, from an adapter or the generator alone', () => {
    resolvePolicyOptions({ allowedOrigins: [ADMIN] });
    generateInlineScript({ allowedOrigins: [ADMIN] });
    expect(said()).toEqual([
      '[payload-live-preview] `mergeTimeoutMs` is not set, so a merge waits as long as the server ' +
        'takes; 3.0 gives it a default deadline. Set `mergeTimeoutMs` now, or `0` to keep none ' +
        '(ADR 0007, row 27).',
    ]);
  });

  it('is not named with a deadline, `0` included, or in production', () => {
    resolvePolicyOptions({ allowedOrigins: [ADMIN], mergeTimeoutMs: 0 });
    generateInlineScript({ allowedOrigins: [ADMIN], mergeTimeoutMs: 10_000 });
    vi.stubEnv('NODE_ENV', 'production');
    generateInlineScript({ allowedOrigins: [ADMIN] });
    expect(said()).toEqual([]);
  });
});

describe('livePreviewScriptProps() without inline delivery (row 32)', () => {
  const options = { allowedOrigins: [ADMIN], mergeDepth: 1, mergeTimeoutMs: 10_000 } as const;
  const refusal =
    "payload-live-preview: `livePreviewScriptProps()` needs `delivery: 'asset'` since 3.0. " +
    'For an inline script render `await LivePreviewScript({ request, ...options })`, which ' +
    'renders nothing for a request it does not authorize (ADR 0007, row 32).';

  it("builds a bootstrap with `delivery: 'asset'`, and says nothing", () => {
    const props = livePreviewScriptProps({ ...options, delivery: 'asset' });
    expect(props.dangerouslySetInnerHTML.__html.length).toBeLessThan(5_000);
    expect(said()).toEqual([]);
  });

  it('has no inline delivery in its type', () => {
    // @ts-expect-error -- the options need `delivery: 'asset'` since 3.0
    expect(() => livePreviewScriptProps(options)).toThrow(refusal);
  });

  it('refuses what a JavaScript caller can still pass, in production too', () => {
    const untyped = livePreviewScriptProps as (options?: object) => unknown;

    expect(() => untyped({ ...options, delivery: 'inline' })).toThrow(refusal);
    expect(() => untyped()).toThrow(refusal);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => untyped(options)).toThrow(refusal);
    expect(said()).toEqual([]);
  });
});

describe('Astro without `mode` (row 33)', () => {
  const options = { allowedOrigins: [ADMIN], mergeTimeoutMs: 10_000 } as const;

  function setUp(extra: Record<string, unknown> = {}): string {
    const injectScript = vi.fn();
    livePreview({ ...options, ...extra }).hooks['astro:config:setup']({
      injectScript,
      updateConfig: () => undefined,
      config: { base: '/' },
    });
    return String(injectScript.mock.calls[0]?.[1] ?? '');
  }

  it('names the inline bytes against the loader bootstrap, both measured, once', () => {
    const inline = setUp();
    setUp();
    const bytes = new TextEncoder().encode(inline).length;
    expect(said()).toHaveLength(1);
    const [line] = said();
    expect(line).toContain(`delivers inline: ${String(bytes)} bytes of runtime in every page`);
    const loader = Number(/against a (\d+)-byte bootstrap/u.exec(line ?? '')?.[1]);
    expect(loader).toBeGreaterThan(0);
    expect(loader).toBeLessThan(2_000);
    expect(line).toContain("3.0 makes `loader` the default; set `mode: 'inline'` to keep this");
  });

  it('says nothing once `mode` is set, either way, or in production', () => {
    setUp({ mode: 'inline' });
    setUp({ mode: 'loader' });
    vi.stubEnv('NODE_ENV', 'production');
    setUp();
    expect(said()).toEqual([]);
  });
});
