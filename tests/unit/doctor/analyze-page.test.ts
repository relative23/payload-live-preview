import { describe, expect, it } from 'vitest';
import { analyzeProbe } from '@doctor/analyze';
import { ADMIN, RUNTIME, context, healthy, response } from './fixtures';

describe('a healthy deployment', () => {
  it('produces no findings at all', () => {
    const report = analyzeProbe(healthy(), context);
    expect(report.findings).toEqual([]);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
  });
});

describe('a missing inline runtime is not automatically a fault', () => {
  it('warns rather than errors, because the client may be started by the consumer', () => {
    const report = analyzeProbe(
      {
        publicResponse: response({ body: '<h1>t</h1>' }),
        previewResponse: response({
          headers: { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` },
          body: '<h1 data-payload-field="title">t</h1>',
        }),
      },
      context,
    );
    const finding = report.findings.find((f) => f.code === 'LP0701');
    expect(finding?.level).toBe('warning');
    expect(report.errors).toBe(0);
    expect(finding?.detail).toContain('LivePreviewClient');
  });

  it('keys on the config identifier, which survives minification, not the banner comment', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: response({
          body: '<script>/* payload-live-preview runtime */</script><p data-payload-field="a">x</p>',
        }),
      },
      context,
    );
    expect(report.findings.map((f) => f.code)).toContain('LP0701');
  });
});

describe('report shape', () => {
  const mixed = () =>
    analyzeProbe(
      {
        publicResponse: response({ body: `${RUNTIME}<p data-payload-field="a">x</p>` }),
        previewResponse: response({
          headers: { 'x-frame-options': 'DENY' },
          body: '<p data-payload-field="a">x</p>',
        }),
      },
      context,
    );

  it('orders findings by severity so the worst is read first', () => {
    const levels = mixed().findings.map((f) => f.level);
    expect(levels).toEqual([...levels].sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)));
    expect(levels[0]).toBe('error');
  });

  it('counts errors and warnings separately', () => {
    const report = mixed();
    expect(report.errors).toBe(report.findings.filter((f) => f.level === 'error').length);
    expect(report.warnings).toBe(report.findings.filter((f) => f.level === 'warning').length);
    expect(report.url).toBe('https://example.com/');
  });

  it('gives every non-informational finding something to act on', () => {
    for (const finding of mixed().findings) {
      if (finding.level === 'info') continue;
      expect(finding.remedy.length).toBeGreaterThan(0);
      expect(finding.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('responses that are not a page at all', () => {
  function preview(status: number, body: string, headers: Record<string, string> = {}) {
    return {
      publicResponse: response({ body: '<h1>t</h1>' }),
      previewResponse: { status, headers, body },
    };
  }

  it.each([
    ['404', 404, '<h1>404 — not found</h1>'],
    ['500', 500, '<h1>Internal Server Error</h1>'],
  ])('reports LP0708 for %s rather than diagnosing the error page', (_label, status, body) => {
    const report = analyzeProbe(preview(status, body), context);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.code).toBe('LP0708');
    expect(report.findings[0]?.level).toBe('error');
  });

  it('reports a redirect with its target instead of auditing the login page behind it', () => {
    const report = analyzeProbe(
      preview(302, '', { location: 'https://example.com/login?next=%2F' }),
      context,
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.code).toBe('LP0708');
    expect(report.findings[0]?.title).toBe(
      'The preview request was redirected (302) to https://example.com/login?next=%2F',
    );
  });

  it('reports LP0708 for a non-HTML content type', () => {
    const report = analyzeProbe(
      preview(200, '{"ok":true}', { 'content-type': 'application/json' }),
      context,
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.title).toContain('application/json');
  });

  it('reports LP0708 for a 2xx with an empty body, which 204 always is', () => {
    const report = analyzeProbe(preview(204, ''), context);
    expect(report.findings[0]?.code).toBe('LP0708');
    expect(report.findings[0]?.title).toContain('empty body');
  });

  it.each([['text/html'], ['text/html; charset=utf-8'], ['application/xhtml+xml']])(
    'accepts %s',
    (contentType) => {
      const report = analyzeProbe(
        {
          publicResponse: response({ body: '<h1>t</h1>' }),
          previewResponse: {
            status: 200,
            headers: {
              'content-type': contentType,
              'content-security-policy': `frame-ancestors 'self' ${ADMIN}`,
            },
            body: `${RUNTIME}<h1 data-payload-field="title">t</h1>`,
          },
        },
        context,
      );
      expect(report.findings).toEqual([]);
    },
  );

  it('accepts a response that states no content type at all', () => {
    expect(analyzeProbe(healthy(), context).findings).toEqual([]);
  });

  it('judges only the preview probe, because a gated site may 302 the public one', () => {
    const report = analyzeProbe(
      { ...healthy(), publicResponse: { status: 302, headers: {}, body: '' } },
      context,
    );
    expect(report.findings).toEqual([]);
  });
});
