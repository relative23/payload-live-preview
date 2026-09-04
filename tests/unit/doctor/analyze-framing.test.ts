import { describe, expect, it } from 'vitest';
import { analyzeProbe } from '@doctor/analyze';
import { ADMIN, RUNTIME, context, healthy, response, withPreview } from './fixtures';

const BOUND = `${RUNTIME}<p data-payload-field="a">x</p>`;

describe('frame-ancestors presence', () => {
  it('warns LP0702 when the preview response declares no frame-ancestors', () => {
    const report = analyzeProbe(withPreview(BOUND, {}), context);
    expect(report.findings.find((f) => f.code === 'LP0702')?.level).toBe('warning');
  });

  it('treats a CSP that never mentions framing as no policy at all', () => {
    const report = analyzeProbe(
      withPreview(BOUND, { 'content-security-policy': "default-src 'self'; script-src 'self'" }),
      context,
    );
    const finding = report.findings.find((f) => f.code === 'LP0702');
    expect(finding?.level).toBe('warning');
    expect(finding?.title).toContain('no frame-ancestors');
  });

  it('finds the directive when it is not the first one', () => {
    const report = analyzeProbe(
      withPreview(BOUND, {
        'content-security-policy': `default-src 'self'; frame-ancestors ${ADMIN}; img-src *`,
      }),
      context,
    );
    expect(report.findings).toEqual([]);
  });

  it('cannot judge the origin when none was supplied, and says nothing rather than guessing', () => {
    const report = analyzeProbe(
      withPreview(BOUND, { 'content-security-policy': "frame-ancestors 'self'" }),
      { url: 'https://example.com/' },
    );
    expect(report.findings.map((f) => f.code)).not.toContain('LP0702');
  });
});

describe('frame-ancestors admission is judged by CSP matching, not by substring', () => {
  function verdict(directive: string, adminOrigin: string = ADMIN) {
    const report = analyzeProbe(withPreview(BOUND, { 'content-security-policy': directive }), {
      url: 'https://example.com/',
      adminOrigin,
    });
    return report.findings.find((f) => f.code === 'LP0702');
  }

  it('escalates to an error when the policy excludes the admin origin', () => {
    const finding = verdict("frame-ancestors 'self'");
    expect(finding?.level).toBe('error');
    expect(finding?.detail).toContain("frame-ancestors 'self'");
    expect(finding?.detail).toContain(`allow ${ADMIN}`);
  });

  it('accepts a wildcard host that covers the admin', () => {
    expect(verdict('frame-ancestors https://*.example.com')).toBeUndefined();
  });

  it('rejects a host that merely contains the admin origin as a prefix', () => {
    expect(verdict(`frame-ancestors ${ADMIN}`, 'https://cms.example.com.evil.com')?.level).toBe(
      'error',
    );
  });

  it('normalises an admin given with a path to its origin', () => {
    expect(verdict(`frame-ancestors ${ADMIN}`, `${ADMIN}/admin`)).toBeUndefined();
    expect(verdict(`frame-ancestors ${ADMIN}`, `${ADMIN}/`)).toBeUndefined();
  });

  it('rejects a port mismatch and accepts a port wildcard', () => {
    expect(verdict(`frame-ancestors ${ADMIN}`, `${ADMIN}:8443`)?.level).toBe('error');
    expect(verdict(`frame-ancestors ${ADMIN}:*`, `${ADMIN}:8443`)).toBeUndefined();
  });

  it('reports an admin that is not an absolute URL instead of throwing', () => {
    const finding = verdict("frame-ancestors 'self'", 'not a url');
    expect(finding?.level).toBe('error');
    expect(finding?.detail).toContain('not an absolute URL');
  });
});

describe('same-origin admin', () => {
  const SAME = 'https://site.example.com';
  const sameContext = { url: `${SAME}/page`, adminOrigin: SAME };

  it("accepts frame-ancestors 'self' when the admin shares the origin", () => {
    const report = analyzeProbe(
      withPreview(`${RUNTIME}<h1 data-payload-field="title">t</h1>`, {
        'content-security-policy': "frame-ancestors 'self'",
      }),
      sameContext,
    );
    expect(report.findings.map((f) => f.code)).not.toContain('LP0702');
  });

  it("still rejects 'self' when the admin is on another origin", () => {
    const report = analyzeProbe(
      withPreview(BOUND, { 'content-security-policy': "frame-ancestors 'self'" }),
      { url: `${SAME}/page`, adminOrigin: 'https://cms.other.com' },
    );
    expect(report.findings.find((f) => f.code === 'LP0702')?.level).toBe('error');
  });

  it('accepts X-Frame-Options: SAMEORIGIN when the admin shares the origin', () => {
    const report = analyzeProbe(
      withPreview(`${RUNTIME}<h1 data-payload-field="title">t</h1>`, {
        'content-security-policy': "frame-ancestors 'self'",
        'x-frame-options': 'SAMEORIGIN',
      }),
      sameContext,
    );
    expect(report.findings).toEqual([]);
  });

  it('rejects X-Frame-Options: DENY even for a same-origin admin', () => {
    const report = analyzeProbe(
      withPreview(BOUND, {
        'content-security-policy': "frame-ancestors 'self'",
        'x-frame-options': 'DENY',
      }),
      sameContext,
    );
    expect(report.findings.find((f) => f.code === 'LP0703')?.level).toBe('error');
  });
});

describe('X-Frame-Options', () => {
  it.each([['DENY'], ['sameorigin']])('reports LP0703 for %s, which no CSP can undo', (value) => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: response({
          headers: { ...probe.previewResponse.headers, 'x-frame-options': value },
          body: probe.previewResponse.body,
        }),
      },
      context,
    );
    expect(report.findings.find((f) => f.code === 'LP0703')?.level).toBe('error');
  });
});
