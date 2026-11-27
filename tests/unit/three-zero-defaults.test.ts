import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { livePreviewScriptProps } from '@adapters/nextjs/index';
import { resetDevWarnings } from '@/types/dev-warning';

/**
 * What 2.4 announced on the server (ADR 0026, 2026-11-03) and 3.0 did:
 * `livePreviewScriptProps()` builds a bootstrap and refuses inline delivery
 * (row 32), without a word in development. The Astro integration's loader
 * default (row 33) is held where loader mode is, in
 * `adapters/astro-loader-mode.test.ts`, and the merge deadline (row 27) in
 * `core/merge-deadline.test.ts`.
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

  it('keeps the route strategy out of that bootstrap, which every visitor receives, unless asked', () => {
    // Row 40 hands the route of a hydrated page to the router by default. This helper's script
    // is rendered for everyone, so the default stops here; what a project asks for travels.
    const config = (html: string): string => /^var __LIVE_PREVIEW_CONFIG__=.*$/mu.exec(html)![0];
    const plain = livePreviewScriptProps({ ...options, delivery: 'asset' });
    const asked = livePreviewScriptProps({
      ...options,
      delivery: 'asset',
      routeStrategy: 'router',
    });

    expect(config(plain.dangerouslySetInnerHTML.__html)).not.toContain('"router"');
    expect(config(asked.dangerouslySetInnerHTML.__html)).toContain('"router"');
    expect(asked.dangerouslySetInnerHTML.__html.length).toBeGreaterThan(
      plain.dangerouslySetInnerHTML.__html.length + 5_000,
    );
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
