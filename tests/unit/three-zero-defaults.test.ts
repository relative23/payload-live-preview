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
