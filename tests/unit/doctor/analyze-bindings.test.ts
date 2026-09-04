import { describe, expect, it } from 'vitest';
import { analyzeProbe } from '@doctor/analyze';
import { generateInlineScript } from '@inline/generator';
import { ADMIN, RUNTIME, context, healthy, response, withPreview } from './fixtures';

const CSP = { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` };
/** What an adapter really injects: the whole runtime, which itself spells `data-payload-field=` in a message. */
const REAL_RUNTIME = `<script>${generateInlineScript({ allowedOrigins: [ADMIN] })}</script>`;

function codes(probe: ReturnType<typeof healthy>): string[] {
  return analyzeProbe(probe, context).findings.map((f) => f.code);
}

describe('the real inline runtime is not markup', () => {
  it('carries the binding attribute name in its own source', () => {
    expect(REAL_RUNTIME).toMatch(/data-payload-field=/u);
  });

  it('reports LP0707 when the real runtime is present and the page has no bindings', () => {
    const report = analyzeProbe(withPreview(`${REAL_RUNTIME}<h1>Title</h1>`, CSP), context);
    expect(report.findings.find((f) => f.code === 'LP0707')?.level).toBe('error');
  });

  it('does not accuse a public page of exposing bindings just because it carries the runtime', () => {
    const probe = {
      publicResponse: response({ body: `${REAL_RUNTIME}<h1>Title</h1>` }),
      previewResponse: response({
        headers: CSP,
        body: `${REAL_RUNTIME}<h1 data-payload-field="title">Title</h1>`,
      }),
    };
    const found = codes(probe);
    expect(found).not.toContain('LP0704');
    expect(found).not.toContain('LP0707');
    expect(found).toContain('LP0710');
  });

  it('counts only the markup, not scripts, styles or comments', () => {
    const body =
      `${REAL_RUNTIME}<style>[data-payload-field="x"]{outline:1px solid}</style>` +
      '<!-- <p data-payload-field="draft">hidden</p> -->' +
      '<h1 data-payload-field="title">Title</h1>';
    const report = analyzeProbe(withPreview(body, CSP), context);
    expect(report.findings).toEqual([]);
    const many = Array.from(
      { length: 49 },
      (_, i) => `<p data-payload-field="f${String(i)}">x</p>`,
    );
    const stuffed = `${REAL_RUNTIME}<style>${'[data-payload-field="s"]{}'.repeat(5)}</style>${many.join('')}`;
    expect(codes(withPreview(stuffed, CSP))).not.toContain('LP0705');
  });

  it('still drops a script whose end tag carries junk, and one that only appears once its neighbour is gone', () => {
    // Browsers close a script on `</script` whatever follows, and a body may
    // hide a block inside another so that one pass of stripping exposes it.
    // Both would otherwise leave the runtime's own message counted as bindings.
    const junkEndTag = `<script>${'data-payload-field= '.repeat(60)}</script foo>`;
    const nested = `<scr<script></script>ipt>${'data-payload-field= '.repeat(60)}</script>`;
    for (const body of [junkEndTag, nested]) {
      expect(
        codes(withPreview(`${body}<h1 data-payload-field="title">Title</h1>`, CSP)),
      ).not.toContain('LP0705');
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

  it('mentions the runtime on the public response only as information, under its own code', () => {
    const probe = healthy();
    const report = analyzeProbe({ ...probe, publicResponse: response({ body: RUNTIME }) }, context);
    const finding = report.findings.find((f) => f.code === 'LP0710');
    expect(finding?.level).toBe('info');
    expect(finding?.remedy).toBe('');
    expect(report.errors).toBe(0);
    expect(report.findings.map((f) => f.code)).not.toContain('LP0701');
  });
});

describe('binding health', () => {
  const field = (i: number) => `<p data-payload-field="f${String(i)}">x</p>`;

  it('warns LP0705 above the default visibility gate threshold, and stays quiet at it', () => {
    const over = analyzeProbe(
      withPreview(RUNTIME + Array.from({ length: 51 }, (_, i) => field(i)).join('')),
      context,
    );
    expect(over.findings.find((f) => f.code === 'LP0705')?.title).toContain('51 bindings');
    const exact = analyzeProbe(
      withPreview(RUNTIME + Array.from({ length: 50 }, (_, i) => field(i)).join('')),
      context,
    );
    expect(exact.findings.map((f) => f.code)).not.toContain('LP0705');
  });

  it('reports LP0707 when the runtime has nothing to write into', () => {
    const report = analyzeProbe(withPreview(`${RUNTIME}<h1>Title</h1>`), context);
    expect(report.findings.find((f) => f.code === 'LP0707')?.level).toBe('error');
  });

  it('warns LP0706 for bindings that sit outside every owner marker', () => {
    const report = analyzeProbe(
      withPreview(
        `${RUNTIME}<p data-payload-field="loose">x</p>` +
          '<div data-payload-owner="global:home"><h1 data-payload-field="title">t</h1></div>',
      ),
      context,
    );
    const finding = report.findings.find((f) => f.code === 'LP0706');
    expect(finding?.level).toBe('warning');
    expect(finding?.title).toContain('1 binding');
  });

  it('says nothing about ownership on a page that does not use owner markers', () => {
    const report = analyzeProbe(
      withPreview(`${RUNTIME}<p data-payload-field="loose">x</p>`),
      context,
    );
    expect(report.findings.map((f) => f.code)).not.toContain('LP0706');
  });
});
