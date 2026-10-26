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

const ID = '__LIVE_PREVIEW_CONFIG__';

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
    ['a number', '<script id="__LIVE_PREVIEW_CONFIG__" type="application/json">5</script>'],
    [
      // The first element is the one the page's client reads, as `getElementById` finds it.
      'an element that does not parse, ahead of one that does',
      '<script id="__LIVE_PREVIEW_CONFIG__" type="application/json">{x</script>' +
        '<script id="__LIVE_PREVIEW_CONFIG__" type="application/json">{"debug":true}</script>',
    ],
    ['null', '<script id="__LIVE_PREVIEW_CONFIG__" type="application/json">null</script>'],
    [
      'an id that only starts with the name',
      '<script id="__LIVE_PREVIEW_CONFIG__2" type="application/json">{"debug":true}</script>',
    ],
    [
      'a type that only starts with application/json',
      '<script id="__LIVE_PREVIEW_CONFIG__" type="application/jsonp">{"debug":true}</script>',
    ],
  ])('reads nothing from %s', (_name, markup) => {
    expect(readServedConfig(markup)).toBeUndefined();
  });

  it('skips what a comment holds, as the browser does', () => {
    expect(readServedConfig(`<!-- ${element(SALA)} -->`)).toBeUndefined();
    const oldTuple = '<!-- <script>var __LIVE_PREVIEW_CONFIG__=[,,,,,,,,true];</script> -->';
    const config = readServedConfig(oldTuple + element({ debug: true }));
    expect(config?.source).toBe('element');
    expect(config?.value('debug')).toBe(true);
  });

  it('reads the id attribute in any case, and its value exactly', () => {
    const upper = element({ debug: true }, 'type="application/json"').replace(' id=', ' ID=');
    expect(readServedConfig(upper)?.value('debug')).toBe(true);
    const lower = element({ debug: true }).replace(
      '__LIVE_PREVIEW_CONFIG__',
      '__live_preview_config__',
    );
    expect(readServedConfig(lower)).toBeUndefined();
  });

  it.each([
    [
      'a ">" in a double-quoted value',
      `<script data-note="a>b" ID="${ID}" type="application/json">`,
    ],
    [
      'a ">" in a single-quoted value',
      `<script data-note='a>b' id='${ID}' type='application/json'>`,
    ],
    ['spaces around "="', `<script id = "${ID}" type = "application/json">`],
    ['unquoted values, the type last', `<script id=${ID} type=application/json>`],
    ['unquoted values, the id last', `<script type=application/json id=${ID}>`],
  ])('reads the element written with %s', (_name, open) => {
    expect(readServedConfig(`${open}{"debug":true}</script>`)?.value('debug')).toBe(true);
  });

  it('reads an element closed by an end tag with junk before its ">"', () => {
    const markup = `<script id="${ID}" type="application/json">{"debug":true}</script >`;
    expect(readServedConfig(markup)?.value('debug')).toBe(true);
  });

  it('passes over the scripts before the element', () => {
    const markup = `<script>var analytics = 1;</script><script src="/app.js"></script>${element({ debug: true })}`;
    expect(readServedConfig(markup)?.value('debug')).toBe(true);
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
    expect(lp0705(`<!-- ${element({ disableVisibilityGate: true })} -->`)?.title).toBe(
      '120 bindings exceed the default visibility gate',
    );
  });

  it('says the configuration, not the runtime, reaches visitors when only the element does', () => {
    const served = page(element(SALA));
    const report = analyzeProbe(
      { ...served, publicResponse: response({ body: `<h1>Title</h1>${element(SALA)}` }) },
      context,
    );
    const lp0710 = report.findings.find((finding) => finding.code === 'LP0710');
    expect(lp0710?.title).toBe('Preview configuration is also served to anonymous visitors');
    expect(lp0710?.detail).toContain('a client it starts itself');
  });
});
