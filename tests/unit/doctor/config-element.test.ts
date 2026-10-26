/**
 * A page that starts `LivePreviewClient` itself has no inline tuple to read. A
 * reference consumer (sala-thai-massage) serializes the options it hands the
 * client into a JSON element with the inline marker as its id, and the doctor
 * read none of it: `--v2` said the configuration was unreadable, and LP0705
 * warned about a gate the page had raised.
 */
import { describe, expect, it } from 'vitest';
import { analyzeProbe } from '@doctor/analyze';
import { analyzeV2Readiness, readServedConfig } from '@doctor/readiness';
import { generateInlineScript } from '@inline/generator';
import type { DoctorProbe } from '@doctor/types';
import { ADMIN, context, response } from './fixtures';

/** The element as the reference consumer writes it: nonce, data attribute, `<` escaped. */
function element(config: Record<string, unknown>, attributes = 'type="application/json"'): string {
  const json = JSON.stringify(config).replaceAll('<', '\\u003c');
  return `<script id="__LIVE_PREVIEW_CONFIG__" ${attributes} data-sala-live-preview-config nonce="n0">${json}</script>`;
}

function page(head: string, bindings = 1): DoctorProbe {
  const fields = Array.from(
    { length: bindings },
    (_, i) => `<p data-payload-field="f${String(i)}">x</p>`,
  ).join('');
  return {
    publicResponse: response({ body: '<h1>Title</h1>' }),
    previewResponse: response({
      headers: { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` },
      body: `${head}${fields}`,
    }),
  };
}

const SALA = {
  allowedOrigins: [ADMIN],
  serverURL: 'https://cms.example.com',
  mergeDepth: 2,
  debug: false,
  disableReferrerDetection: true,
  disableLocalhostMatching: true,
  scopeBindingsByOwner: true,
  revealEditedField: true,
  visibilityGateThreshold: Number.MAX_SAFE_INTEGER,
};

describe('readServedConfig', () => {
  it('reads the named options of a JSON configuration element', () => {
    const config = readServedConfig(element({ ...SALA, title: '</script>' }));
    expect(config?.source).toBe('element');
    expect(config?.value('visibilityGateThreshold')).toBe(Number.MAX_SAFE_INTEGER);
    expect(config?.value('mergeDepth')).toBe(2);
    expect(config?.value('sanitizerPolicy')).toBeUndefined();
  });

  it('prefers the inline tuple, which is what the runtime reads', () => {
    const inline = `<script>${generateInlineScript({ allowedOrigins: [ADMIN], debug: true })}</script>`;
    const config = readServedConfig(inline + element({ debug: false }));
    expect(config?.source).toBe('inline');
    expect(config?.value('debug')).toBe(true);
  });

  it.each([
    ['an element that is not JSON', element(SALA, 'type="module"')],
    ['an element without a type', element(SALA, '')],
    ['an array', '<script id="__LIVE_PREVIEW_CONFIG__" type="application/json">[1,2]</script>'],
    [
      'text that does not parse',
      '<script id="__LIVE_PREVIEW_CONFIG__" type="application/json">{x</script>',
    ],
  ])('reads nothing from %s', (_name, markup) => {
    expect(readServedConfig(markup)).toBeUndefined();
  });
});

describe('the doctor on a page with a configuration element', () => {
  it('runs the v2 readiness check against it', () => {
    expect(analyzeV2Readiness(page(element(SALA)))).toEqual([]);

    const compat = analyzeV2Readiness(page(element({ ...SALA, sanitizerPolicy: 'compat' })));
    expect(compat).toEqual([
      expect.objectContaining({ level: 'warning', title: 'Sanitizer is in compat mode' }),
    ]);
    expect(compat[0]?.remedy).toContain("Drop the explicit `sanitizerPolicy: 'compat'`");
  });

  it("reads `defaults: 'v1'` in it as the profile", () => {
    const findings = analyzeV2Readiness(page(element({ allowedOrigins: [ADMIN], defaults: 'v1' })));
    expect(findings.filter((finding) => finding.level === 'warning')).toHaveLength(4);
    expect(findings.every((finding) => finding.remedy.includes("`defaults: 'v1'`"))).toBe(true);
  });

  it('judges LP0705 against the gate it configures', () => {
    const lp0705 = (head: string) =>
      analyzeProbe(page(head, 120), context).findings.find((f) => f.code === 'LP0705');
    expect(lp0705(element(SALA))).toBeUndefined();
    expect(
      lp0705(element({ ...SALA, visibilityGateThreshold: undefined, disableVisibilityGate: true })),
    ).toBeUndefined();
    expect(lp0705(element({ allowedOrigins: [ADMIN] }))?.title).toBe(
      '120 bindings exceed the default visibility gate',
    );
  });
});
