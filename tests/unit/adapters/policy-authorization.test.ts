import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertStrictConfiguration,
  createPreviewPolicy,
  inlineScriptConfig,
  resolvePolicyOptions,
  type PreviewAuthorizationHookResult,
} from '@adapters/shared/policy';
import { resetDeprecationWarnings } from '@adapters/shared/deprecation';
import {
  authorizePreviewRequest,
  type AuthorizedPreviewContext,
} from '@security/preview-authorization';

/**
 * The authorization step of the shared policy (ADR 0006 §5): what a
 * refusal blocks, what a look-alike is worth, what `strict` refuses to run
 * with, and what `defaults: 'v2'` sets. The adapters' own suites prove the
 * plumbing; this proves the decision.
 */

const ADMIN = 'https://admin.example.com';
const INTENT = 'https://site.example.com/page?preview=true';

function request(url = 'https://site.example.com/') {
  return new Request(url);
}

async function realContext(): Promise<AuthorizedPreviewContext> {
  const result = await authorizePreviewRequest(request(), {
    type: 'verifier',
    verify: () => ({ subject: 'editor' }),
  });
  if (!result.authorized) throw new Error('expected authorization');
  return result.context;
}

const env = process.env['NODE_ENV'];
beforeEach(() => {
  process.env['NODE_ENV'] = 'development';
  resetDeprecationWarnings();
});
afterEach(() => {
  process.env['NODE_ENV'] = env;
  vi.restoreAllMocks();
});

describe('decide — with an authorizePreview hook', () => {
  const options = { allowedOrigins: [ADMIN], authorizePreview: () => null };

  it('never runs the hook without intent', async () => {
    const authorize = vi.fn<() => PreviewAuthorizationHookResult>(() => null);
    const decision = await createPreviewPolicy(options).decide(request(), { authorize });
    expect(authorize).not.toHaveBeenCalled();
    expect(decision.isPreview).toBe(false);
  });

  it('a refusal blocks injection, CSP and the nonce, whatever autoInject and shouldInject say', async () => {
    const shouldInject = vi.fn(() => true);
    const decision = await createPreviewPolicy({ ...options, autoInject: true }).decide(
      request(INTENT),
      { authorize: () => null, shouldInject },
    );
    expect(decision).toMatchObject({
      isPreview: true,
      authorization: null,
      outcome: 'invalid',
      inject: false,
      cspMode: false,
      exposeNonce: false,
    });
    expect(shouldInject).not.toHaveBeenCalled();
  });

  it('carries the outcome of a full authorizePreviewRequest() result', async () => {
    const decision = await createPreviewPolicy(options).decide(request(INTENT), {
      authorize: () => ({ authorized: false, outcome: 'expired', context: null }),
    });
    expect(decision.outcome).toBe('expired');
    expect(decision.inject).toBe(false);
  });

  it('accepts a real context, bare or wrapped, and then decides as before', async () => {
    const context = await realContext();
    const bare = await createPreviewPolicy(options).decide(request(INTENT), {
      authorize: () => context,
    });
    expect(bare).toMatchObject({
      authorization: context,
      outcome: 'authorized',
      inject: true,
      cspMode: 'frame-ancestors',
      exposeNonce: true,
    });
    const wrapped = await createPreviewPolicy(options).decide(request(INTENT), {
      authorize: () => ({ authorized: true, outcome: 'authorized', context }),
    });
    expect(wrapped.authorization).toBe(context);
  });

  it('refuses every look-alike: booleans, literals, copies, and a wrapped fake', async () => {
    const context = await realContext();
    const fakes: unknown[] = [
      true,
      { authorized: true },
      { ...context },
      JSON.parse(JSON.stringify(context)),
      { authorized: true, outcome: 'authorized', context: { ...context } },
    ];
    for (const fake of fakes) {
      const decision = await createPreviewPolicy(options).decide(request(INTENT), {
        authorize: () => fake as PreviewAuthorizationHookResult,
      });
      expect(decision.authorization, JSON.stringify(fake)).toBeNull();
      expect(decision.inject).toBe(false);
      expect(decision.cspMode).toBe(false);
    }
  });

  it('treats a throwing hook as unavailable, never as authorized', async () => {
    const decision = await createPreviewPolicy(options).decide(request(INTENT), {
      authorize: () => Promise.reject(new Error('idp down')),
    });
    expect(decision).toMatchObject({ outcome: 'unavailable', inject: false, cspMode: false });
  });

  it('still lets shouldInject veto injection, and only injection, once authorized', async () => {
    const context = await realContext();
    const decision = await createPreviewPolicy(options).decide(request(INTENT), {
      authorize: () => context,
      shouldInject: () => false,
    });
    expect(decision.inject).toBe(false);
    expect(decision.cspMode).toBe('frame-ancestors');
    expect(decision.exposeNonce).toBe(true);
  });

  it('reports whether a hook is configured so adapters can bind it', () => {
    expect(createPreviewPolicy(options).authorizes).toBe(true);
    expect(createPreviewPolicy({ allowedOrigins: [ADMIN] }).authorizes).toBe(false);
  });
});

describe('decide — without a hook (1.x behaviour)', () => {
  it('keeps gating on intent and exposes the nonce, and says so once per process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN] });
    createPreviewPolicy({ allowedOrigins: [ADMIN] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('authorizePreview');
    const decision = await policy.decide(request(INTENT));
    expect(decision).toMatchObject({
      isPreview: true,
      authorization: null,
      outcome: undefined,
      inject: true,
      cspMode: 'frame-ancestors',
      exposeNonce: true,
    });
  });

  it('does not warn in production', () => {
    process.env['NODE_ENV'] = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createPreviewPolicy({ allowedOrigins: [ADMIN] });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when a hook is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createPreviewPolicy({ allowedOrigins: [ADMIN], authorizePreview: () => null });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('strict', () => {
  const hook = () => null;

  it('refuses to start without authorizePreview', () => {
    expect(() => createPreviewPolicy({ strict: true, allowedOrigins: [ADMIN] })).toThrow(
      /authorizePreview/,
    );
  });

  it('refuses empty allowedOrigins', () => {
    expect(() => createPreviewPolicy({ strict: true, authorizePreview: hook })).toThrow(
      /allowedOrigins/,
    );
  });

  it('refuses non-https admin origins outside development, allows them inside', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() =>
      assertStrictConfiguration({ authorizePreview: hook, allowedOrigins: ['http://admin.local'] }),
    ).toThrow(/https/);
    process.env['NODE_ENV'] = 'development';
    expect(() =>
      assertStrictConfiguration({ authorizePreview: hook, allowedOrigins: ['http://admin.local'] }),
    ).not.toThrow();
  });

  it('refuses explicit referrer trust', () => {
    expect(() =>
      createPreviewPolicy({
        strict: true,
        authorizePreview: hook,
        allowedOrigins: [ADMIN],
        previewSignals: ['query', 'referer'],
      }),
    ).toThrow(/referer/);
  });

  it('starts with a complete configuration and does not warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      createPreviewPolicy({ strict: true, authorizePreview: hook, allowedOrigins: [ADMIN] }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("defaults: 'v2'", () => {
  it('implies strict and query-only intent, and flips the runtime rows into the inline config', () => {
    const options = {
      defaults: 'v2',
      authorizePreview: () => null,
      allowedOrigins: [ADMIN],
    } as const;
    expect(resolvePolicyOptions(options)).toEqual({
      strict: true,
      previewSignals: ['query'],
      skipUnchanged: true,
      disableReferrerDetection: true,
      eventSourcePolicy: 'parent-or-opener',
    });
    expect(inlineScriptConfig(options)).toEqual({
      allowedOrigins: [ADMIN],
      skipUnchanged: true,
      disableReferrerDetection: true,
      eventSourcePolicy: 'parent-or-opener',
    });
  });

  it('lets explicit options win over the profile', () => {
    const resolved = resolvePolicyOptions({
      defaults: 'v2',
      strict: false,
      previewSignals: ['query', 'fetch-dest'],
      skipUnchanged: false,
    });
    expect(resolved.strict).toBe(false);
    expect(resolved.previewSignals).toEqual(['query', 'fetch-dest']);
    expect(resolved.skipUnchanged).toBe(false);
  });

  it("under 'v2' an iframe fetch destination alone is no longer intent", async () => {
    const policy = createPreviewPolicy({
      defaults: 'v2',
      authorizePreview: () => null,
      allowedOrigins: [ADMIN],
    });
    const framed = new Request('https://site.example.com/', {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    expect((await policy.decide(framed)).isPreview).toBe(false);
    expect((await policy.decide(request(INTENT))).isPreview).toBe(true);
  });

  it("changes nothing under 'v1' or when unset — an empty options object stays an empty config", () => {
    expect(inlineScriptConfig({})).toEqual({});
    expect(inlineScriptConfig({ defaults: 'v1' })).toEqual({});
    expect(resolvePolicyOptions({}).strict).toBe(false);
    expect(resolvePolicyOptions({}).previewSignals).toBeUndefined();
  });
});
