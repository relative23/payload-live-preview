import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewPolicy, type PreviewAuthorizationHookResult } from '@adapters/shared/policy';
import { inlineScriptConfig, resolvePolicyOptions } from '@adapters/shared/policy-options';
import { assertStrictConfiguration } from '@adapters/shared/strict';
import { resetDevWarnings } from '@adapters/shared/dev-warning';
import {
  authorizePreviewRequest,
  PreviewConfigurationError,
  type AuthorizedPreviewContext,
} from '@security/preview-authorization';

/** The authorization step of the shared policy (ADR 0006 §5), and what the profiles set. */

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
  resetDevWarnings();
});
afterEach(() => {
  process.env['NODE_ENV'] = env;
  vi.restoreAllMocks();
});

describe('decide — with an authorizePreview hook', () => {
  const options = { allowedOrigins: [ADMIN], authorizePreview: () => null };
  const refuse = { authorize: () => null };

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

  it('re-throws a PreviewConfigurationError so a misconfigured strategy is loud', async () => {
    await expect(
      createPreviewPolicy(options).decide(request(INTENT), {
        authorize: () => Promise.reject(new PreviewConfigurationError('secret too short')),
      }),
    ).rejects.toThrow(PreviewConfigurationError);
    // A copy of the class from another bundle is recognised by name.
    const foreign = Object.assign(new Error('bad cookie name'), {
      name: 'PreviewConfigurationError',
    });
    await expect(
      createPreviewPolicy(options).decide(request(INTENT), {
        authorize: () => Promise.reject(foreign),
      }),
    ).rejects.toBe(foreign);
  });

  it('throws when the hook is configured but not bound to the request', async () => {
    await expect(createPreviewPolicy(options).decide(request(INTENT))).rejects.toThrow(
      /authorize/u,
    );
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
    expect(createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] }).authorizes).toBe(false);
  });

  it('under the default profile an iframe fetch destination alone is not intent', async () => {
    const policy = createPreviewPolicy(options);
    const framed = new Request('https://site.example.com/', {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    expect((await policy.decide(framed, refuse)).isPreview).toBe(false);
    expect((await policy.decide(request(INTENT), refuse)).isPreview).toBe(true);
  });
});

describe("decide — without a hook (defaults: 'v1')", () => {
  it('keeps gating on intent and exposes the nonce, and says so once per process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const policy = createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
    createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
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
    createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
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

  it('accepts https admin origins in production, which is the configuration strict exists for', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() =>
      assertStrictConfiguration({
        authorizePreview: hook,
        allowedOrigins: ['https://admin.example.com', 'https://cms.example.com:8443'],
      }),
    ).not.toThrow();
    process.env['NODE_ENV'] = 'development';
  });

  it('refuses an admin origin that is not a URL at all', () => {
    // Unparseable is not https, and strict mode may not fall through to "fine".
    process.env['NODE_ENV'] = 'production';
    expect(() =>
      assertStrictConfiguration({ authorizePreview: hook, allowedOrigins: ['admin.local'] }),
    ).toThrow(/https/);
    process.env['NODE_ENV'] = 'development';
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

  it("refuses the referrer trust the 'v1' profile fills in, unless the signals are narrowed", () => {
    const base = {
      strict: true,
      defaults: 'v1',
      authorizePreview: hook,
      allowedOrigins: [ADMIN],
    } as const;
    expect(() => createPreviewPolicy(base)).toThrow(/referer/);
    expect(() => createPreviewPolicy({ ...base, previewSignals: ['query'] })).not.toThrow();
  });

  it('starts with a complete configuration and does not warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      createPreviewPolicy({ strict: true, authorizePreview: hook, allowedOrigins: [ADMIN] }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('profiles and runtime rows', () => {
  it('the default profile is strict and query-only, and writes no override rows', () => {
    const options = { authorizePreview: () => null, allowedOrigins: [ADMIN] } as const;
    expect(resolvePolicyOptions(options)).toEqual({ strict: true, previewSignals: ['query'] });
    expect(inlineScriptConfig(options)).toEqual({ allowedOrigins: [ADMIN] });
    expect(inlineScriptConfig({})).toEqual({});
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

  it("an explicit 'v1' writes the override rows the v2 runtime would not use", () => {
    expect(inlineScriptConfig({ defaults: 'v1' })).toEqual({
      // Carried through so the generator accepts an omitted `mergeDepth`; it
      // is not a wire slot.
      defaults: 'v1',
      skipUnchanged: false,
      disableReferrerDetection: false,
      eventSourcePolicy: 'any',
      sanitizerPolicy: 'compat',
    });
    expect(resolvePolicyOptions({ defaults: 'v1' }).strict).toBe(false);
    expect(resolvePolicyOptions({ defaults: 'v1' }).previewSignals).toEqual([
      'query',
      'fetch-dest',
      'referer',
    ]);
  });

  it('forwards the individual runtime rows without downgrading the whole profile', () => {
    expect(
      inlineScriptConfig({
        eventSourcePolicy: 'any',
        disableReferrerDetection: false,
        disableLocalhostMatching: true,
      }),
    ).toEqual({
      eventSourcePolicy: 'any',
      disableReferrerDetection: false,
      disableLocalhostMatching: true,
    });
    expect(
      inlineScriptConfig({ defaults: 'v1', eventSourcePolicy: 'parent-or-opener' }),
    ).toMatchObject({ eventSourcePolicy: 'parent-or-opener', disableReferrerDetection: false });
  });

  it('serverURL without mergeDepth is refused at construction and in the inline config', () => {
    const base = { authorizePreview: () => null, allowedOrigins: [ADMIN] };
    expect(() => createPreviewPolicy({ ...base, serverURL: 'https://cms.example.com' })).toThrow(
      /mergeDepth/,
    );
    expect(() => inlineScriptConfig({ serverURL: 'https://cms.example.com' })).toThrow(
      /mergeDepth/,
    );
    expect(() =>
      createPreviewPolicy({ ...base, serverURL: 'https://cms.example.com', mergeDepth: 0 }),
    ).not.toThrow();
    expect(() =>
      inlineScriptConfig({ defaults: 'v1', serverURL: 'https://cms.example.com' }),
    ).not.toThrow();
    // The generator repeats the check, so the profile has to reach it too.
    expect(() =>
      createPreviewPolicy({
        ...base,
        defaults: 'v1',
        serverURL: 'https://cms.example.com',
      }).scriptTag('n0nce'),
    ).not.toThrow();
  });
});
