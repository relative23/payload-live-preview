import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewPolicy, type PreviewAuthorizationHookResult } from '@adapters/shared/policy';
import { inlineScriptConfig, resolvePolicyOptions } from '@adapters/shared/policy-options';
import { assertStrictConfiguration } from '@adapters/shared/strict';
import { resetDevWarnings } from '@/runtime/types/dev-warning';
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

  it('an iframe fetch destination alone is not intent', async () => {
    const policy = createPreviewPolicy(options);
    const framed = new Request('https://site.example.com/', {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    expect((await policy.decide(framed, refuse)).isPreview).toBe(false);
    expect((await policy.decide(request(INTENT), refuse)).isPreview).toBe(true);
  });
});

describe('a policy needs a hook', () => {
  it('does not start without one, in production or outside it, and names the way to one', () => {
    const refusal =
      'payload-live-preview: strict mode requires `authorizePreview` — response changes must be ' +
      'gated on a verified context, not on intent (ADR 0006). Pass a hook that returns ' +
      '`authorizePreviewRequest(request, strategy)` from `payload-live-preview/server` ' +
      '(docs/authorization.md).';

    expect(() => createPreviewPolicy({ allowedOrigins: [ADMIN] })).toThrow(refusal);
    process.env['NODE_ENV'] = 'production';
    expect(() => createPreviewPolicy({ allowedOrigins: [ADMIN] })).toThrow(refusal);
  });

  it('does not warn when a hook and a merge deadline are configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createPreviewPolicy({
      allowedOrigins: [ADMIN],
      authorizePreview: () => null,
      mergeTimeoutMs: 10_000,
    });
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

  it('says what to do about each refusal', () => {
    const refusal = (build: () => unknown): string => {
      try {
        build();
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    const withoutHook = refusal(() =>
      createPreviewPolicy({ strict: true, allowedOrigins: [ADMIN] }),
    );
    const withoutOrigins = refusal(() =>
      createPreviewPolicy({ strict: true, authorizePreview: hook }),
    );
    process.env['NODE_ENV'] = 'production';
    const plainOrigin = refusal(() =>
      assertStrictConfiguration({ authorizePreview: hook, allowedOrigins: ['http://admin.local'] }),
    );

    // In full: a message is a row of literals, and one that nothing reads can go blank unnoticed.
    expect(withoutHook).toBe(
      'payload-live-preview: strict mode requires `authorizePreview` — response changes must be gated on a verified context, not on intent (ADR 0006). Pass a hook that returns `authorizePreviewRequest(request, strategy)` from `payload-live-preview/server` (docs/authorization.md).',
    );
    expect(withoutOrigins).toBe(
      "payload-live-preview: strict mode requires explicit, non-empty `allowedOrigins`. Name the origin of the Payload admin, as in `allowedOrigins: ['https://cms.example.com']`.",
    );
    expect(plainOrigin).toBe(
      'payload-live-preview: strict mode requires https admin origins in production; got "http://admin.local". Name the https origin of the admin; http passes only where `NODE_ENV` is not `production`.',
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

  it('says once when it accepts an http admin origin only because NODE_ENV is not set', () => {
    // A production server without NODE_ENV counts as development, so the https rule is off there.
    delete process.env['NODE_ENV'];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const options = {
      authorizePreview: hook,
      allowedOrigins: ['https://admin.example.com', 'http://admin.local', 'http://cms.local'],
      mergeTimeoutMs: 10_000,
    };
    expect(() => assertStrictConfiguration(options)).not.toThrow();
    assertStrictConfiguration(options);
    expect(warn).toHaveBeenCalledOnce();
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(
      '"http://admin.local", "http://cms.local" because `NODE_ENV` is not set',
    );
    expect(message).toContain(
      'Set `NODE_ENV=production` on a production server, and strict mode requires https admin origins there.',
    );
    expect(message).not.toContain('https://admin.example.com');

    warn.mockClear();
    resetDevWarnings();
    process.env['NODE_ENV'] = 'development';
    assertStrictConfiguration(options);
    delete process.env['NODE_ENV'];
    assertStrictConfiguration({
      authorizePreview: hook,
      allowedOrigins: [ADMIN],
      mergeTimeoutMs: 10_000,
    });
    expect(warn).not.toHaveBeenCalled();
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
    ).toThrow(
      "payload-live-preview: strict mode disables referrer trust; remove 'referer' from " +
        '`previewSignals`.',
    );
  });

  it('starts with a complete configuration and does not warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      createPreviewPolicy({
        strict: true,
        authorizePreview: hook,
        allowedOrigins: [ADMIN],
        mergeTimeoutMs: 10_000,
      }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the defaults table and the runtime rows', () => {
  it('counts the query alone as intent and writes no row the runtime already has', () => {
    const options = { authorizePreview: () => null, allowedOrigins: [ADMIN] } as const;
    expect(resolvePolicyOptions(options)).toEqual({ previewSignals: ['query'] });
    expect(inlineScriptConfig(options)).toEqual({ allowedOrigins: [ADMIN] });
    expect(inlineScriptConfig({})).toEqual({});
  });

  it('lets explicit options win over the table', () => {
    const resolved = resolvePolicyOptions({
      defaults: 'v2',
      strict: true,
      previewSignals: ['query', 'fetch-dest'],
      skipUnchanged: false,
    });
    expect(resolved.previewSignals).toEqual(['query', 'fetch-dest']);
    expect(resolved.skipUnchanged).toBe(false);
  });

  it('forwards the individual runtime rows', () => {
    expect(
      inlineScriptConfig({
        eventSourcePolicy: 'any',
        enableReferrerDetection: true,
        enableLocalhostMatching: false,
      }),
    ).toEqual({
      eventSourcePolicy: 'any',
      enableReferrerDetection: true,
      enableLocalhostMatching: false,
    });
  });

  it('serverURL without mergeDepth is refused at construction and in the inline config', () => {
    const base = { authorizePreview: () => null, allowedOrigins: [ADMIN] };
    expect(() => createPreviewPolicy({ ...base, serverURL: 'https://cms.example.com' })).toThrow(
      'payload-live-preview: `serverURL` needs an explicit `mergeDepth` — choose the population ' +
        'depth deliberately (0 for none; ADR 0007, entry 10).',
    );
    expect(() => inlineScriptConfig({ serverURL: 'https://cms.example.com' })).toThrow(
      /mergeDepth/,
    );
    expect(() =>
      createPreviewPolicy({ ...base, serverURL: 'https://cms.example.com', mergeDepth: 0 }),
    ).not.toThrow();
    // The generator repeats the check.
    expect(() =>
      createPreviewPolicy({
        ...base,
        serverURL: 'https://cms.example.com',
        mergeDepth: 0,
      }).scriptTag('n0nce'),
    ).not.toThrow();
  });
});
