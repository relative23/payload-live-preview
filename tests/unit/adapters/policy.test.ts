import { describe, expect, it } from 'vitest';
import {
  buildPreviewCsp,
  createPreviewPolicy,
  previewIntentFor,
  injectIntoHead,
  inlineScriptConfig,
  normalizeCspMode,
} from '@adapters/shared/policy';

/**
 * The policy is the one copy of what four adapters used to decide each on
 * their own. Its contract is therefore the contract the adapter tests already
 * pin from the outside; these tests pin it from the inside, per decision, so
 * a change here is caught by name rather than by four framework fixtures.
 */

const ADMIN = 'https://admin.example.com';

function request(url = 'https://site.example.com/', headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe('previewIntentFor', () => {
  it('is intent, not authorization: a query flag, an iframe destination, or an admin referer', () => {
    const options = { allowedOrigins: [ADMIN] };
    expect(previewIntentFor(request(), options)).toBe(false);
    expect(previewIntentFor(request('https://site.example.com/?preview=true'), options)).toBe(true);
    expect(
      previewIntentFor(
        request('https://site.example.com/', { 'sec-fetch-dest': 'iframe' }),
        options,
      ),
    ).toBe(true);
    expect(
      previewIntentFor(
        request('https://site.example.com/', { referer: `${ADMIN}/admin` }),
        options,
      ),
    ).toBe(true);
  });

  it("treats inject: 'always' as intent on every request", () => {
    expect(previewIntentFor(request(), { inject: 'always' })).toBe(true);
  });

  it('honours a narrowed signal set', () => {
    const options = { allowedOrigins: [ADMIN], previewSignals: ['query'] as const };
    expect(
      previewIntentFor(
        request('https://site.example.com/', { 'sec-fetch-dest': 'iframe' }),
        options,
      ),
    ).toBe(false);
    expect(previewIntentFor(request('https://site.example.com/?preview=1'), options)).toBe(true);
  });
});

describe('normalizeCspMode', () => {
  it('reads unset and true as frame-ancestors only, the way every adapter always has', () => {
    expect(normalizeCspMode(undefined)).toBe('frame-ancestors');
    expect(normalizeCspMode(true)).toBe('frame-ancestors');
    expect(normalizeCspMode('frame-ancestors')).toBe('frame-ancestors');
    expect(normalizeCspMode('full')).toBe('full');
    expect(normalizeCspMode(false)).toBe(false);
  });
});

describe('inlineScriptConfig', () => {
  it('forwards only the options that were given, so runtime defaults stay the single source', () => {
    expect(inlineScriptConfig({})).toEqual({});
    expect(inlineScriptConfig({ debounceMs: 25, skipUnchanged: true })).toEqual({
      debounceMs: 25,
      skipUnchanged: true,
    });
  });

  it('does not forward adapter-only options into the runtime config', () => {
    const config = inlineScriptConfig({ inject: 'always', manageCsp: 'full', autoInject: false });
    expect(config).toEqual({});
  });
});

describe('buildPreviewCsp', () => {
  it('adds frame-ancestors for the admin and any extras, keeping what the policy already had', () => {
    const csp = buildPreviewCsp(
      { allowedOrigins: [ADMIN], frameAncestorsExtra: ['https://embed.example.com'] },
      'n0nce',
      "default-src 'self'; img-src *",
      'frame-ancestors',
    );
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('img-src *');
    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain(ADMIN);
    expect(csp).toContain('https://embed.example.com');
    expect(csp).not.toContain('script-src');
  });

  it("adds a nonce-bound script-src only in 'full' mode", () => {
    const full = buildPreviewCsp(
      { strictDynamic: true, scriptSrcExtra: ['https://cdn.example.com'] },
      'n0nce',
      '',
      'full',
    );
    expect(full).toContain("'nonce-n0nce'");
    expect(full).toContain("'strict-dynamic'");
    expect(full).toContain('https://cdn.example.com');
  });
});

describe('injectIntoHead', () => {
  it('inserts the tag right after the opening head tag, attributes included', () => {
    const out = injectIntoHead(
      '<html><head lang="en"><title>t</title></head></html>',
      '<script>x</script>',
    );
    expect(out).toBe('<html><head lang="en"><script>x</script><title>t</title></head></html>');
  });

  it('declines a document without a head, so a fragment is never prepended to', () => {
    expect(injectIntoHead('<div>fragment</div>', '<script>x</script>')).toBeUndefined();
  });
});

describe('createPreviewPolicy — decisions', () => {
  it('decides nothing for a request without intent', () => {
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN] });
    expect(policy.decide(request())).toEqual({ isPreview: false, inject: false, cspMode: false });
  });

  it('injects and manages CSP for an intent request by default', () => {
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN] });
    expect(policy.decide(request('https://site.example.com/?preview=true'))).toEqual({
      isPreview: true,
      inject: true,
      cspMode: 'frame-ancestors',
    });
  });

  it("lets the adapter's content filter veto injection but never CSP", () => {
    // shouldInject is a route filter, not an authorization boundary — the
    // split F-09 describes. It stays true here on purpose until 1.1.0 gates
    // every mutation on a verified context.
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN] });
    const decision = policy.decide(request('https://site.example.com/?preview=true'), () => false);
    expect(decision.inject).toBe(false);
    expect(decision.cspMode).toBe('frame-ancestors');
  });

  it('consults the content filter only once intent is established', () => {
    // A consumer's filter must not start running on every ordinary request.
    let calls = 0;
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN] });
    policy.decide(request(), () => {
      calls += 1;
      return true;
    });
    expect(calls).toBe(0);
    policy.decide(request('https://site.example.com/?preview=true'), () => {
      calls += 1;
      return true;
    });
    expect(calls).toBe(1);
  });

  it('honours autoInject: false while still managing CSP', () => {
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN], autoInject: false });
    const decision = policy.decide(request('https://site.example.com/?preview=true'));
    expect(decision.inject).toBe(false);
    expect(decision.cspMode).toBe('frame-ancestors');
  });

  it('turns CSP off entirely with manageCsp: false, even with intent', () => {
    const policy = createPreviewPolicy({ manageCsp: false, inject: 'always' });
    expect(policy.decide(request()).cspMode).toBe(false);
  });
});

describe('createPreviewPolicy — artefacts', () => {
  it('builds the script body once and stamps each tag with the nonce it is given', () => {
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN] });
    const a = policy.scriptTag('n1');
    const b = policy.scriptTag('n2');
    expect(a).toContain('nonce="n1"');
    expect(b).toContain('nonce="n2"');
    // Same body, different nonce: the body depends on the options only.
    expect(a.replace('n1', '')).toBe(b.replace('n2', ''));
    expect(a).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('issues a fresh nonce on each call', () => {
    const policy = createPreviewPolicy({});
    expect(policy.nonce()).not.toBe(policy.nonce());
  });

  it('routes csp() through the same builder the adapters used to carry', () => {
    const policy = createPreviewPolicy({ allowedOrigins: [ADMIN] });
    expect(policy.csp('', 'n', 'frame-ancestors')).toBe(
      buildPreviewCsp({ allowedOrigins: [ADMIN] }, 'n', '', 'frame-ancestors'),
    );
  });
});
