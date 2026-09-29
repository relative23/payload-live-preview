import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
/* eslint-disable @typescript-eslint/no-deprecated -- the deprecations are what this file holds */
import { hasPreviewIntent, isPreviewRequest } from '@/index';
import { resolvePolicyOptions } from '@adapters/shared/policy-options';
import { generateInlineScript } from '@inline/generator';
import { authorizePreviewRequest } from '@security/preview-authorization';
import { issuePreviewToken } from '@security/preview-token';
import { setSanitizerDocument } from '@security/sanitizer';
import { resetDevWarnings } from '@/types/dev-warning';

/**
 * What 3.0 removes says so once per process while 2.x still runs it, outside
 * production only, and names what replaces it (ADR 0026).
 */

const SITE = 'https://site.example.com';
const ADMIN = 'https://admin.example.com';
const SECRET = 'a'.repeat(32);

function framedRequest(): { url: string; headers: { get(name: string): string | null } } {
  return {
    url: `${SITE}/page`,
    headers: { get: (name) => (name.toLowerCase() === 'referer' ? `${ADMIN}/admin` : null) },
  };
}

async function tokenRequest(): Promise<Request> {
  const token = await issuePreviewToken({ audience: SITE }, { secret: SECRET });
  return new Request(`${SITE}/?previewToken=${encodeURIComponent(token)}`);
}

describe('what 3.0 removes warns once in development (ADR 0026)', () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    resetDevWarnings();
    vi.stubEnv('NODE_ENV', 'development');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
    resetDevWarnings();
    setSanitizerDocument(null);
    resetDevWarnings();
  });

  function warnings(): string[] {
    return warn.mock.calls.map(([message]) => String(message));
  }

  it('isPreviewRequest() answers as hasPreviewIntent() and names it, once', () => {
    const request = { url: `${SITE}/?preview=true`, headers: { get: () => null } };

    expect(isPreviewRequest(request)).toBe(hasPreviewIntent(request));
    expect(isPreviewRequest(request, { signals: ['fetch-dest'] })).toBe(false);

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /`isPreviewRequest\(\)`.*removed in 3\.0.*`hasPreviewIntent\(\)`.*`pll migrate`/u,
    );
  });

  it('hasPreviewIntent({ adminOrigins }) names allowedOrigins, once; allowedOrigins alone is silent', () => {
    expect(hasPreviewIntent(framedRequest(), { allowedOrigins: [ADMIN] })).toBe(true);
    expect(warnings()).toEqual([]);

    expect(hasPreviewIntent(framedRequest(), { adminOrigins: [ADMIN] })).toBe(true);
    expect(hasPreviewIntent(framedRequest(), { adminOrigins: [ADMIN] })).toBe(true);

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /adminOrigins.*removed in 3\.0.*`allowedOrigins`.*`pll migrate`/u,
    );
  });

  it('setSanitizerDocument() names the per-call document, once', () => {
    setSanitizerDocument(null);
    setSanitizerDocument(null);

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/`setSanitizerDocument\(\)`.*removed in 3\.0.*\{ document \}/u);
  });

  it('onUnboundChange names onUnfaithfulPatch and the codemod, from an adapter or the generator', () => {
    expect(resolvePolicyOptions({ onUnboundChange: 'route' }).strict).toBe(true);
    generateInlineScript({ onUnboundChange: 'ignore' });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /`onUnboundChange`.*removed in 3\.0.*`onUnfaithfulPatch`.*`pll migrate`/u,
    );
  });

  it("defaults: 'v1' names the codemod that writes its rows out, from an adapter or the generator", () => {
    expect(resolvePolicyOptions({ defaults: 'v1' }).strict).toBe(false);
    expect(generateInlineScript({ defaults: 'v1' })).toContain('"v1"');
    resolvePolicyOptions({ defaults: 'v2' });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/`defaults: 'v1'`.*removed in 3\.0.*`pll migrate`/u);
  });

  it('a replay store without consume names consume, once, and still admits a first use', async () => {
    const used = new Set<string>();
    const strategy = {
      type: 'signed-token' as const,
      secret: SECRET,
      audience: SITE,
      replay: {
        isUsed: (id: string) => used.has(id),
        markUsed: (id: string) => void used.add(id),
      },
    };

    expect((await authorizePreviewRequest(await tokenRequest(), strategy)).authorized).toBe(true);
    expect((await authorizePreviewRequest(await tokenRequest(), strategy)).authorized).toBe(true);

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/`isUsed`.*`markUsed`.*removed in 3\.0.*`consume\(/u);
  });

  it('a consume store is silent', async () => {
    const strategy = {
      type: 'signed-token' as const,
      secret: SECRET,
      audience: SITE,
      replay: { consume: () => true },
    };

    expect((await authorizePreviewRequest(await tokenRequest(), strategy)).authorized).toBe(true);
    expect(warnings()).toEqual([]);
  });

  it('none of them warns in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    isPreviewRequest(framedRequest());
    hasPreviewIntent(framedRequest(), { adminOrigins: [ADMIN] });
    setSanitizerDocument(null);
    resolvePolicyOptions({ defaults: 'v1', onUnboundChange: 'route' });
    generateInlineScript({ defaults: 'v1', onUnboundChange: 'route' });
    await authorizePreviewRequest(await tokenRequest(), {
      type: 'signed-token',
      secret: SECRET,
      audience: SITE,
      replay: { isUsed: () => false, markUsed: () => undefined },
    });

    expect(warnings()).toEqual([]);
  });

  it('names each warning by a fixed key on the realm, which every copy of the package shares', async () => {
    // Two copies in one process, possibly of different versions, must agree
    // on these strings, or each would print its own line.
    isPreviewRequest(framedRequest());
    hasPreviewIntent(framedRequest(), { adminOrigins: [ADMIN] });
    setSanitizerDocument(null);
    resolvePolicyOptions({ defaults: 'v1', onUnboundChange: 'route' });
    await authorizePreviewRequest(await tokenRequest(), {
      type: 'signed-token',
      secret: SECRET,
      audience: SITE,
      replay: { isUsed: () => false, markUsed: () => undefined },
    });

    const issued = (globalThis as Record<string, unknown>)[
      '__payloadLivePreviewDeprecationsWarned'
    ];
    expect([...(issued as Set<string>)].sort()).toEqual([
      'admin-origins',
      'defaults-v1',
      'is-preview-request',
      'on-unbound-change',
      'replay-is-used',
      'set-sanitizer-document',
    ]);
    expect(warnings()).toHaveLength(6);
  });
});
