import { describe, expect, it } from 'vitest';
import { injectIntoHead } from '@adapters/shared/html-inject';
import {
  buildPreviewCsp,
  createPreviewPolicy,
  previewIntentFor,
  normalizeCspMode,
} from '@adapters/shared/policy';
import { inlineScriptConfig } from '@adapters/shared/policy-options';

/** The shared policy's decisions, pinned by name rather than through four framework fixtures. */

const ADMIN = 'https://admin.example.com';

function request(url = 'https://site.example.com/', headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe('previewIntentFor', () => {
  it('the default is query-only: an iframe destination or admin referer is not intent', () => {
    const options = { allowedOrigins: [ADMIN] };
    expect(previewIntentFor(request(), options)).toBe(false);
    expect(previewIntentFor(request('https://site.example.com/?preview=true'), options)).toBe(true);
    expect(
      previewIntentFor(
        request('https://site.example.com/', { 'sec-fetch-dest': 'iframe' }),
        options,
      ),
    ).toBe(false);
    expect(
      previewIntentFor(
        request('https://site.example.com/', { referer: `${ADMIN}/admin` }),
        options,
      ),
    ).toBe(false);
  });

  it('the broad signal set is opt-in via previewSignals or defaults: v1', () => {
    const broad = {
      allowedOrigins: [ADMIN],
      previewSignals: ['query', 'fetch-dest', 'referer'] as const,
    };
    expect(
      previewIntentFor(request('https://site.example.com/', { 'sec-fetch-dest': 'iframe' }), broad),
    ).toBe(true);
    expect(
      previewIntentFor(request('https://site.example.com/', { referer: `${ADMIN}/admin` }), broad),
    ).toBe(true);
    expect(
      previewIntentFor(request('https://site.example.com/', { 'sec-fetch-dest': 'iframe' }), {
        allowedOrigins: [ADMIN],
        defaults: 'v1',
      }),
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
  it('reads unset and true as frame-ancestors only', () => {
    expect(normalizeCspMode(undefined)).toBe('frame-ancestors');
    expect(normalizeCspMode(true)).toBe('frame-ancestors');
    expect(normalizeCspMode('frame-ancestors')).toBe('frame-ancestors');
    expect(normalizeCspMode('full')).toBe('full');
    expect(normalizeCspMode(false)).toBe(false);
  });
});

describe('inlineScriptConfig', () => {
  // Each row is one adapter option and the key it travels under. An option the
  // adapter drops here never reaches the runtime, and nothing else notices.
  const WIRE = [
    ['defaults', 'v1', 'defaults', 'v1'],
    [
      'allowedOrigins',
      ['https://admin.example.com'],
      'allowedOrigins',
      ['https://admin.example.com'],
    ],
    ['serverURL', 'https://cms.example.com', 'serverURL', 'https://cms.example.com'],
    ['apiRoute', '/api', 'apiRoute', '/api'],
    ['mergeDepth', 2, 'mergeDepth', 2],
    ['revealEditedField', true, 'revealEditedField', true],
    ['debug', true, 'debug', true],
    ['debounceMs', 5, 'debounceMs', 5],
    ['heartbeatMs', 1000, 'heartbeatMs', 1000],
    ['skipUnchanged', false, 'skipUnchanged', false],
    ['scopeBindingsByOwner', true, 'scopeBindingsByOwner', true],
    ['disableReferrerDetection', false, 'disableReferrerDetection', false],
    ['disableLocalhostMatching', true, 'disableLocalhostMatching', true],
    ['eventSourcePolicy', 'any', 'eventSourcePolicy', 'any'],
    ['sanitizerPolicy', 'compat', 'sanitizerPolicy', 'compat'],
    ['fragments', { endpoint: '/payload/fragment' }, 'fragmentEndpoint', '/payload/fragment'],
  ] as const;

  it.each(WIRE)('puts %s on the wire', (option, value, wireKey, wireValue) => {
    // `mergeDepth` keeps the serverURL row from failing the explicit-depth rule.
    const config = inlineScriptConfig({ mergeDepth: 1, [option]: value });
    expect(config).toHaveProperty(wireKey, wireValue);
  });

  it.each(WIRE)('leaves %s off the wire when it is not given', (_option, _value, wireKey) => {
    expect(inlineScriptConfig({})).not.toHaveProperty(wireKey);
  });

  it('forwards only the options that were given, so runtime defaults stay the single source', () => {
    expect(inlineScriptConfig({})).toEqual({});
    expect(inlineScriptConfig({ debounceMs: 25, skipUnchanged: true })).toEqual({
      debounceMs: 25,
      skipUnchanged: true,
    });
  });

  it('does not forward adapter-only options into the runtime config', () => {
    expect(inlineScriptConfig({ inject: 'always', manageCsp: 'full', autoInject: false })).toEqual(
      {},
    );
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
  const TAG = '<script>x</script>';

  it('inserts the tag right after the opening head tag, attributes included', () => {
    expect(injectIntoHead('<html><head lang="en"><title>t</title></head></html>', TAG)).toBe(
      '<html><head lang="en"><script>x</script><title>t</title></head></html>',
    );
  });

  it.each([
    ['<meta charset="utf-8">'],
    ['<meta charset=utf-8>'],
    ['<meta http-equiv="Content-Type" content="text/html; charset=utf-8">'],
    ['<META CHARSET="UTF-8" />'],
  ])('inserts after the encoding declaration %s so it stays in the 1024-byte prescan', (meta) => {
    expect(injectIntoHead(`<html><head>${meta}<title>t</title></head></html>`, TAG)).toBe(
      `<html><head>${meta}${TAG}<title>t</title></head></html>`,
    );
  });

  it.each([
    ['an upper-case head tag', '<HEAD>', '</HEAD>', ''],
    ['a head tag with attributes over lines', '<head\n  lang="en">', '</head>', ''],
    [
      'a charset meta after other head content',
      '<head>',
      '</head>',
      '<title>t</title><meta charset="utf-8">',
    ],
    [
      'a content-type meta with spaces around =',
      '<head>',
      '</head>',
      '<meta http-equiv = "content-type" content="text/html; charset=utf-8">',
    ],
  ])('handles %s', (_case, open, close, before) => {
    const html = `<html>${open}${before}<link rel="x"></link>${close}</html>`;
    const at = before === '' ? open.length + '<html>'.length : html.indexOf(before) + before.length;
    expect(injectIntoHead(html, TAG)).toBe(`${html.slice(0, at)}${TAG}${html.slice(at)}`);
  });

  it('does not let a charset meta after </head> pull the tag out of the head', () => {
    const html = '<html><head><title>t</title></head><body><meta charset="utf-8"></body></html>';
    expect(injectIntoHead(html, TAG)).toBe(
      `<html><head>${TAG}<title>t</title></head><body><meta charset="utf-8"></body></html>`,
    );
  });

  it('ignores a charset meta outside the head and other meta tags', () => {
    expect(
      injectIntoHead(
        '<html><head><meta name="viewport" content="x"></head><meta charset="utf-8"></html>',
        TAG,
      ),
    ).toBe(
      '<html><head><script>x</script><meta name="viewport" content="x"></head><meta charset="utf-8"></html>',
    );
  });

  it('declines a document without a head, so a fragment is never prepended to', () => {
    expect(injectIntoHead('<div>fragment</div>', TAG)).toBeUndefined();
  });
});

describe('createPreviewPolicy — decisions', () => {
  it('decides nothing for a request without intent', async () => {
    const policy = createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
    expect(await policy.decide(request())).toMatchObject({
      isPreview: false,
      inject: false,
      cspMode: false,
      exposeNonce: false,
      authorization: null,
    });
  });

  it('injects and manages CSP for an intent request by default', async () => {
    const policy = createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
    expect(await policy.decide(request('https://site.example.com/?preview=true'))).toMatchObject({
      isPreview: true,
      inject: true,
      cspMode: 'frame-ancestors',
      exposeNonce: true,
      authorization: null,
      outcome: undefined,
    });
  });

  it("lets the adapter's content filter veto injection but never CSP", async () => {
    const policy = createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
    const decision = await policy.decide(request('https://site.example.com/?preview=true'), {
      shouldInject: () => false,
    });
    expect(decision.inject).toBe(false);
    expect(decision.cspMode).toBe('frame-ancestors');
  });

  it('consults the content filter only once intent is established', async () => {
    let calls = 0;
    const policy = createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
    const shouldInject = (): boolean => {
      calls += 1;
      return true;
    };
    await policy.decide(request(), { shouldInject });
    expect(calls).toBe(0);
    await policy.decide(request('https://site.example.com/?preview=true'), { shouldInject });
    expect(calls).toBe(1);
  });

  it('honours autoInject: false while still managing CSP', async () => {
    const policy = createPreviewPolicy({
      defaults: 'v1',
      allowedOrigins: [ADMIN],
      autoInject: false,
    });
    const decision = await policy.decide(request('https://site.example.com/?preview=true'));
    expect(decision.inject).toBe(false);
    expect(decision.cspMode).toBe('frame-ancestors');
  });

  it('turns CSP off entirely with manageCsp: false, even with intent', async () => {
    const policy = createPreviewPolicy({ defaults: 'v1', manageCsp: false, inject: 'always' });
    expect((await policy.decide(request())).cspMode).toBe(false);
  });
});

describe('createPreviewPolicy — artefacts', () => {
  it('builds the script body once and stamps each tag with the nonce it is given', () => {
    const policy = createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
    const a = policy.scriptTag('n1');
    const b = policy.scriptTag('n2');
    expect(a).toContain('nonce="n1"');
    expect(b).toContain('nonce="n2"');
    expect(a.replace('n1', '')).toBe(b.replace('n2', ''));
    expect(a).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('issues a fresh nonce on each call', () => {
    const policy = createPreviewPolicy({ defaults: 'v1' });
    expect(policy.nonce()).not.toBe(policy.nonce());
  });

  it('routes csp() through the same builder', () => {
    const policy = createPreviewPolicy({ defaults: 'v1', allowedOrigins: [ADMIN] });
    expect(policy.csp('', 'n', 'frame-ancestors')).toBe(
      buildPreviewCsp({ allowedOrigins: [ADMIN] }, 'n', '', 'frame-ancestors'),
    );
  });
});
