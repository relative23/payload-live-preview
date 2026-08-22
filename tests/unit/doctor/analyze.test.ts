import { describe, expect, it } from 'vitest';
import { analyzeProbe } from '@doctor/analyze';
import type { DoctorResponse } from '@doctor/types';

const RUNTIME = '<script>var __LIVE_PREVIEW_CONFIG__=[["https://cms.example.com"]];</script>';
const ADMIN = 'https://cms.example.com';

function response(overrides: Partial<DoctorResponse> = {}): DoctorResponse {
  return {
    status: 200,
    headers: {},
    body: '<html><body></body></html>',
    ...overrides,
  };
}

/** A deployment with nothing wrong with it. */
function healthy(): { publicResponse: DoctorResponse; previewResponse: DoctorResponse } {
  return {
    publicResponse: response({ body: '<h1>Title</h1>' }),
    previewResponse: response({
      headers: { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` },
      body: `${RUNTIME}<h1 data-payload-field="title">Title</h1>`,
    }),
  };
}

const context = { url: 'https://example.com/', adminOrigin: ADMIN };

function codes(probe: ReturnType<typeof healthy>): string[] {
  return analyzeProbe(probe, context).findings.map((f) => f.code);
}

describe('a healthy deployment', () => {
  it('produces no findings at all', () => {
    const report = analyzeProbe(healthy(), context);
    expect(report.findings).toEqual([]);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
  });
});

describe('injection', () => {
  it('reports LP0701 when the preview response carries no runtime', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: response({ body: '<h1 data-payload-field="title">t</h1>' }),
      },
      context,
    );
    const finding = report.findings.find((f) => f.code === 'LP0701');
    expect(finding?.level).toBe('error');
    expect(report.errors).toBeGreaterThan(0);
  });

  it('mentions the runtime on the public response only as information', () => {
    // inject: 'always' is a legitimate configuration, so this must not fail a run.
    const probe = healthy();
    const report = analyzeProbe({ ...probe, publicResponse: response({ body: RUNTIME }) }, context);
    const finding = report.findings.find((f) => f.code === 'LP0701');
    expect(finding?.level).toBe('info');
    expect(report.errors).toBe(0);
    expect(finding?.remedy).toBe('');
  });
});

describe('framing headers', () => {
  it('warns LP0702 when the preview response declares no frame-ancestors', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: response({ body: `${RUNTIME}<p data-payload-field="a">x</p>` }),
      },
      context,
    );
    expect(report.findings.find((f) => f.code === 'LP0702')?.level).toBe('warning');
  });

  it('escalates LP0702 to an error when the policy excludes the admin origin', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: response({
          headers: { 'content-security-policy': "frame-ancestors 'self'" },
          body: `${RUNTIME}<p data-payload-field="a">x</p>`,
        }),
      },
      context,
    );
    const finding = report.findings.find((f) => f.code === 'LP0702');
    expect(finding?.level).toBe('error');
    expect(finding?.detail).toContain("frame-ancestors 'self'");
  });

  it('cannot judge the origin when none was supplied, and says nothing rather than guessing', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: response({
          headers: { 'content-security-policy': "frame-ancestors 'self'" },
          body: `${RUNTIME}<p data-payload-field="a">x</p>`,
        }),
      },
      { url: 'https://example.com/' },
    );
    expect(report.findings.map((f) => f.code)).not.toContain('LP0702');
  });

  it('reports LP0703 for an X-Frame-Options that no CSP can undo', () => {
    const probe = healthy();
    for (const value of ['DENY', 'sameorigin']) {
      const report = analyzeProbe(
        {
          ...probe,
          previewResponse: {
            ...probe.previewResponse,
            headers: { ...probe.previewResponse.headers, 'x-frame-options': value },
          },
        },
        context,
      );
      expect(report.findings.find((f) => f.code === 'LP0703')?.level).toBe('error');
    }
  });
});

describe('what the public response gives away', () => {
  it('warns LP0704 when anonymous visitors receive binding attributes', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        publicResponse: response({
          body: '<h1 data-payload-field="title">t</h1><p data-payload-field="sub">s</p>',
        }),
      },
      context,
    );
    const finding = report.findings.find((f) => f.code === 'LP0704');
    expect(finding?.level).toBe('warning');
    expect(finding?.title).toContain('2 binding');
  });
});

describe('binding health', () => {
  it('warns LP0705 above the default visibility gate threshold', () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => `<p data-payload-field="f${String(i)}">x</p>`,
    ).join('');
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: { ...probe.previewResponse, body: RUNTIME + many },
      },
      context,
    );
    expect(report.findings.find((f) => f.code === 'LP0705')?.title).toContain('51 bindings');
  });

  it('stays quiet at exactly the threshold', () => {
    const exactly = Array.from(
      { length: 50 },
      (_, i) => `<p data-payload-field="f${String(i)}">x</p>`,
    ).join('');
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: { ...probe.previewResponse, body: RUNTIME + exactly },
      },
      context,
    );
    expect(report.findings.map((f) => f.code)).not.toContain('LP0705');
  });

  it('reports LP0707 when the runtime has nothing to write into', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: { ...probe.previewResponse, body: `${RUNTIME}<h1>Title</h1>` },
      },
      context,
    );
    expect(report.findings.find((f) => f.code === 'LP0707')?.level).toBe('error');
  });

  it('warns LP0706 for bindings that sit outside every owner marker', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: {
          ...probe.previewResponse,
          body:
            `${RUNTIME}<p data-payload-field="loose">x</p>` +
            '<div data-payload-owner="global:home"><h1 data-payload-field="title">t</h1></div>',
        },
      },
      context,
    );
    const finding = report.findings.find((f) => f.code === 'LP0706');
    expect(finding?.level).toBe('warning');
    expect(finding?.title).toContain('1 binding');
  });

  it('says nothing about ownership on a page that does not use owner markers', () => {
    const probe = healthy();
    const report = analyzeProbe(
      {
        ...probe,
        previewResponse: {
          ...probe.previewResponse,
          body: `${RUNTIME}<p data-payload-field="loose">x</p>`,
        },
      },
      context,
    );
    expect(report.findings.map((f) => f.code)).not.toContain('LP0706');
  });
});

describe('report shape', () => {
  it('orders findings by severity so the worst is read first', () => {
    const report = analyzeProbe(
      {
        publicResponse: response({ body: `${RUNTIME}<p data-payload-field="a">x</p>` }),
        previewResponse: response({
          headers: { 'x-frame-options': 'DENY' },
          body: '<p data-payload-field="a">x</p>',
        }),
      },
      context,
    );
    const levels = report.findings.map((f) => f.level);
    expect(levels).toEqual([...levels].sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)));
    expect(levels[0]).toBe('error');
  });

  it('counts errors and warnings separately', () => {
    const report = analyzeProbe(
      {
        publicResponse: response({ body: '<p data-payload-field="a">x</p>' }),
        previewResponse: response({ body: '<p data-payload-field="a">x</p>' }),
      },
      context,
    );
    expect(report.errors).toBe(report.findings.filter((f) => f.level === 'error').length);
    expect(report.warnings).toBe(report.findings.filter((f) => f.level === 'warning').length);
    expect(report.url).toBe('https://example.com/');
  });

  it('gives every non-informational finding something to act on', () => {
    const report = analyzeProbe(
      {
        publicResponse: response({ body: '<p data-payload-field="a">x</p>' }),
        previewResponse: response({
          headers: { 'x-frame-options': 'DENY' },
          body: '<p data-payload-field="a">x</p>',
        }),
      },
      context,
    );
    for (const finding of report.findings) {
      if (finding.level === 'info') continue;
      expect(finding.remedy.length).toBeGreaterThan(0);
      expect(finding.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('regression guards', () => {
  it('looks for the marker the generator actually emits', () => {
    // The banner comment is stripped by minification; only the config
    // identifier survives, and the audit must key on that.
    expect(codes({ ...healthy() })).toEqual([]);
    const withBannerOnly = healthy();
    const report = analyzeProbe(
      {
        ...withBannerOnly,
        previewResponse: {
          ...withBannerOnly.previewResponse,
          body: '<script>/* payload-live-preview runtime */</script><p data-payload-field="a">x</p>',
        },
      },
      context,
    );
    expect(report.findings.map((f) => f.code)).toContain('LP0701');
  });
});
